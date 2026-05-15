import Redis from "ioredis";
import { REDIS_URL } from "./config.js";

// ── Prefix conventions ────────────────────────────────────────────────────────
//  user:{id}            HASH  — name, email, password_hash, created_at
//  user:email:{email}   STR   → userId (lower-auxiliary index)
//  game:{name}:lb       ZSET  — score (auto-paid by ZADD)
//  global:lb            ZSET  — global score across all games
//  score:h:{uid}:{game} ZSET  — {timestamp_unix_ms} → score  (history)
//  game:list            SET   — list of all game names
// ─────────────────────────────────────────────────────────────────────────────

const redis = new Redis(REDIS_URL);

redis.on("connect", () => console.log("[Redis] connected"));
redis.on("error",   (err) => console.error("[Redis] error:", err.message));

// ── User helpers ─────────────────────────────────────────────────────────────

export async function createUser({ name, email, plainPassword }) {
  const existing = await redis.get(`user:email:${email.toLowerCase()}`);
  if (existing) throw Object.assign(new Error("EMAIL_EXISTS"), {
    type: "CONFLICT", details: { field: "email", message: "Email already registered" }
  });

  const userId    = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const hash      = await crypto.subtle.importKey("raw",
                          new TextEncoder().encode(plainPassword), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // bcrypt-hash via Node crypto
  const { hash: bcryptHash } = await import("bcryptjs");
  const passwordHash = await bcryptHash.hash(plainPassword, 10);
  const now = Date.now().toString();

  await redis.hmset(`user:${userId}`, {
    id: userId, name, email: email.toLowerCase(),
    password_hash: passwordHash, created_at: now
  });
  await redis.set(`user:email:${email.toLowerCase()}`, userId);

  return { id: userId, name, email: email.toLowerCase(), created_at: now };
}

export async function findByEmail(email) {
  const userId = await redis.get(`user:email:${email.toLowerCase()}`);
  if (!userId) return null;
  return redis.hgetall(`user:${userId}`).then((row) => ({ ...row, id: userId }));
}

export async function findById(userId) {
  const data = await redis.hgetall(`user:${userId}`);
  return data.id ? { ...data } : null;
}

// ── Score helpers ────────────────────────────────────────────────────────────

export async function addScore(game, userId, score) {
  const scoreNum = Number(score);
  const nowMs    = Date.now();

  await Promise.all([
    // Update per-game leaderboard  (score → member)
    redis.zadd(`game:${game}:lb`, scoreNum, userId),
    // Ensure game is listed
    redis.sadd("game:list", game),
  ]);

  // Update global leaderboard — keep cumulative score across ALL games
  // = total points ever earned by this user
  const stored = await redis.zscore("global:lb", userId);
  const current = stored !== null ? Number(stored) : 0;
  await redis.zadd("global:lb", current + scoreNum, userId);

  // Append to history with ms timestamp as the score so ZSDESC gives newest first
  await redis.zadd(`score:h:${userId}:${game}`, nowMs, nowMs);
  // store the actual score value as a companion hash for query efficiency
  await redis.hset(`score:snap:${userId}:${game}:${nowMs}`, {
    score: scoreNum.toString(), timestamp_ms: nowMs.toString()
  });

  return { game, userId, score: scoreNum, timestamp_ms: nowMs };
}

// ── Leaderboard helpers ──────────────────────────────────────────────────────

/**
 * Returns top N on a ranked board.
 * withUser = true  → also fetches user names (slightly heavier)
 */
export async function getTop(boardKey, count = 10, withUser = false) {
  const raw = await redis.zrevrange(boardKey, 0, count - 1, { withScores: true });
  // raw = [member0, score0, member1, score1, ...]
  const entries = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({
      userId: raw[i],
      score:  Number(raw[i + 1]),
      ...(withUser ? await getUserBrief(raw[i]) : {})
    });
  }
  return entries;
}

export async function getUserBrief(userId) {
  const h = await redis.hgetall(`user:${userId}`);
  if (!h.id) return { name: "Unknown" };
  return { name: h.name };
}

/**
 * Rank of user on board (0-based, 0 = 1st place). Returns null if not ranked.
 */
export async function getRank(boardKey, userId) {
  const rank = await redis.zrevrank(boardKey, userId);
  if (rank === null) return null;
  return { rank: rank + 1, userId };
}

/**
 * Scores around a user on the board.
 * offset=5, count=10 → returns 5 above, user, 4 below = 10 entries
 */
export async function getAroundUser(boardKey, userId, offset = 5, count = 11) {
  const rank = await redis.zrevrank(boardKey, userId);
  if (rank === null) return null;
  const start = Math.max(0, rank - offset);
  const end   = start + count - 1;
  const raw   = await redis.zrevrange(boardKey, start, end, { withScores: true });
  const entries = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({
      userId: raw[i],
      score:  Number(raw[i + 1]),
      ...(await getUserBrief(raw[i]))
    });
  }
  return { centreUserId: userId, centreRank: rank + 1, windowSize: entries.length, entries };
}

// ── History / report helpers ──────────────────────────────────────────────────

/**
 * Returns all submitted scores + timestamps for a user → game.
 */
export async function getScoreHistory(userId, game) {
  const raw  = await redis.zrevrange(`score:h:${userId}:${game}`, 0, -1, { withScores: true });
  const out  = [];
  for (let i = 0; i < raw.length; i += 2) {
    const ts    = raw[i];             // ms timestamp stored as member
    const snap  = await redis.hgetall(`score:snap:${userId}:${game}:${ts}`);
    out.push({ timestamp_ms: Number(ts), score: Number(snap.score || raw[i+1]) });
  }
  return out;
}

/**
 * Returns all unique games a user has played.
 */
export async function getUserGames(userId) {
  return redis.zrevrange(`score:h:*`, 0, -1).catch(() => []);
}

export async function getAllGameNames() {
  return redis.smembers("game:list");
}

/**
 * Top-players report — top N per game and overall global.
 * @param {number} count
 * @param {string} [period] "all" | "daily" | "weekly" | "monthly"
 *   period narrows to scores submitted within that window.
 */
export async function getTopPlayersReport(count = 10, period = "all") {
  const games = await getAllGameNames();
  const report = { period, totalPlayers: 0, global: [], perGame: {} };

  // Global leaderboard
  let global = await getTop("global:lb", count, true);
  if (period !== "all") {
    const cutoff = windowCutoff(period);
    // filter out players whose last score is stale
    const fresh = [];
    for (const p of global) {
      const ts = await redis.zrevrange(`score:h:*`, 0, 0, { withScores: true });
      if (ts.length > 0 && Number(ts[1]) >= cutoff) fresh.push(p);
    }
    global = fresh;
  }
  report.global = global;

  // Per-game leaderboard
  const encoder = new TextEncoder();
  const patMatcher = new RegExp(`^score:h:(.+):`); // rebuild per-game scope

  for (const game of games) {
    let top = await getTop(`game:${game}:lb`, count, true);
    if (period !== "all") {
      const cutoff = windowCutoff(period);
      top = top.filter(async (p) => {
        const lastTs = await redis.zrevrange(`score:h:${p.userId}:${game}`, 0, 0, { withScores: true });
        return lastTs[1] !== undefined && Number(lastTs[1]) >= cutoff;
      });
    }
    report.perGame[game] = top;
  }

  report.totalPlayers = await redis.zcount("global:lb", "-inf", "+inf");
  return report;
}

function windowCutoff(period) {
  switch (period) {
    case "daily":   return Date.now() - 86_400_000;
    case "weekly":  return Date.now() - 604_800_000;
    case "monthly": return Date.now() - 2_592_000_000;
    default:        return 0;
  }
}

export default redis;
