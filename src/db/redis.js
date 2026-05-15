import pkg from "ioredis";
import pkg2 from "bcryptjs";
import { REDIS_URL } from "../config.js";

const { Redis }           = pkg;
const { hash: bcryptHash } = pkg2;

// ── Key layout ────────────────────────────────────────────────────────────────
//  user:{id}              HASH   — {id, name, email, password_hash, created_at}
//  user:email:{email}     STR    → userId
//  game:{name}:lb         ZSET   — score → userId
//  global:lb              ZSET   — totalScore → userId
//  score:h:{uid}:{game}   ZSET   — ts_ms → ts_ms   (history zset)
//  score:snap:{uid}:{g}:{ts}ms HASH — { score, timestamp_ms }
//  game:list              SET    — all registered game names
// ─────────────────────────────────────────────────────────────────────────────

const redis = new Redis(REDIS_URL);

redis.on("connect", () => console.log("[Redis] connected"));
redis.on("error",   (err) => console.error("[Redis] error:", err.message));

// ── Users ─────────────────────────────────────────────────────────────────────

export async function createUser({ name, email, plainPassword }) {
  const existing = await redis.get(`user:email:${email.toLowerCase()}`);
  if (existing) throw Object.assign(new Error("EMAIL_EXISTS"), {
    type: "CONFLICT",
    details: { field: "email", message: "Email already registered" },
  });

  const userId       = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const passwordHash = await bcryptHash(plainPassword, 10);
  const now          = Date.now().toString();

  await redis.hmset(`user:${userId}`, {
    id: userId, name, email: email.toLowerCase(),
    password_hash: passwordHash, created_at: now,
  });
  await redis.set(`user:email:${email.toLowerCase()}`, userId);

  return { id: userId, name, email: email.toLowerCase(), created_at: now };
}

export async function findByEmail(email) {
  const userId = await redis.get(`user:email:${email.toLowerCase()}`);
  if (!userId) return null;
  const row = await redis.hgetall(`user:${userId}`);
  return row.id ? { ...row, id: userId } : null;
}

export async function findById(userId) {
  const data = await redis.hgetall(`user:${userId}`);
  return data.id ? { ...data } : null;
}

// ── Scores ────────────────────────────────────────────────────────────────────

export async function addScore(game, userId, score) {
  const scoreNum = Number(score);
  const nowMs    = Date.now();

  await Promise.all([
    redis.zadd(`game:${game}:lb`, scoreNum, userId),
    redis.sadd  ("game:list",       game),
  ]);

  // Global = cumulative total across ALL games
  const stored  = await redis.zscore("global:lb", userId);
  const current = stored !== null ? Number(stored) : 0;
  await redis.zadd("global:lb", current + scoreNum, userId);

  // History: ms-timestamps give most-recent-first with ZREVRANGE
  await redis.zadd(`score:h:${userId}:${game}`, nowMs, nowMs);

  // Snapshot for O(1) score read
  await redis.hset(`score:snap:${userId}:${game}:${nowMs}`, {
    score: scoreNum.toString(),
    timestamp_ms: nowMs.toString(),
  });

  return { game, userId, score: scoreNum, timestamp_ms: nowMs };
}

// ── Leaderboards ──────────────────────────────────────────────────────────────

export async function getTop(boardKey, count = 10, withUser = false) {
  const raw = await redis.zrevrange(boardKey, 0, count - 1, 'WITHSCORES');
  const out = [];
  for (let i = 0; i < raw.length; i += 2) {
    out.push({
      userId: raw[i],
      score:  Number(raw[i + 1]),
      ...(withUser ? await getUserBrief(raw[i]) : {}),
    });
  }
  return out;
}

export async function getUserBrief(userId) {
  const h = await redis.hgetall(`user:${userId}`);
  return h.id ? { name: h.name } : { name: "Unknown" };
}

/** 1-based rank, null if not ranked */
export async function getRank(boardKey, userId) {
  const r = await redis.zrevrank(boardKey, userId);
  return r === null ? null : { rank: r + 1, userId };
}

export async function getAroundUser(boardKey, userId, offset = 5, count = 11) {
  const rank = await redis.zrevrank(boardKey, userId);
  if (rank === null) return null;
  const start = Math.max(0, rank - offset);
  const end   = start + count - 1;
  const raw   = await redis.zrevrange(boardKey, start, end, 'WITHSCORES');
  const entries = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({
      userId: raw[i],
      score:  Number(raw[i + 1]),
      ...(await getUserBrief(raw[i])),
    });
  }
  return { centreUserId: userId, centreRank: rank + 1, windowSize: entries.length, entries };
}

// ── History & reports ─────────────────────────────────────────────────────────

export async function getScoreHistory(userId, game) {
  const raw = await redis.zrevrange(`score:h:${userId}:${game}`, 0, -1, 'WITHSCORES');
  const out = [];
  for (let i = 0; i < raw.length; i += 2) {
    const ts   = raw[i];
    const snap = await redis.hgetall(`score:snap:${userId}:${game}:${ts}`);
    out.push({ timestamp_ms: Number(ts), score: Number(snap.score || raw[i + 1]) });
  }
  return out;
}

export async function getAllGameNames() {
  return redis.smembers("game:list");
}

/** Needed by leaderboard.js games route. Returns [] — use getAllGameNames() instead. */
export async function getUserGames() {
  return [];  // superseded by getAllGameNames / SMEMBERS game:list
}

export async function getTopPlayersReport(count = 10, period = "all") {
  const games = await getAllGameNames();
  const report = { period, totalPlayers: 0, global: [], perGame: {} };

  // Global — filter by last-score timestamp when period ≠ "all"
  let global = await getTop("global:lb", count, true);
  if (period !== "all") {
    const cutoff = windowCutoff(period);
    const stale  = [];
    for (const p of global) {
      let lastTs = 0;
      for (const game of games) {
        const r = await redis.zrevrange(`score:h:${p.userId}:${game}`, 0, 0, 'WITHSCORES');
        if (r.length) lastTs = Math.max(lastTs, Number(r[1]));
      }
      if (lastTs < cutoff) stale.push(p.userId);
    }
    global = global.filter(p => !stale.includes(p.userId));
  }
  report.global = global;

  // Per-game
  for (const game of games) {
    let top = await getTop(`game:${game}:lb`, count, true);
    if (period !== "all") {
      const cutoff = windowCutoff(period);
      top = (await Promise.all(
        top.map(async (p) => {
          const r = await redis.zrevrange(`score:h:${p.userId}:${game}`, 0, 0, 'WITHSCORES');
          return (r[1] ?? 0) >= cutoff ? p : null;
        })
      )).filter(Boolean);
    }
    report.perGame[game] = top;
  }

  report.totalPlayers = await redis.zcount("global:lb", "-inf", "+inf");
  return report;
}

function windowCutoff(period) {
  const ms = { daily: 86_400_000, weekly: 604_800_000, monthly: 2_592_000_000 };
  return Date.now() - (ms[period] || 0);
}

export default redis;
