import { Router } from "express";
import { getTop, getUserBrief, getUserGames, getRank, getScoreHistory, getAroundUser, getTopPlayersReport } from "../db/redis.js";
import authRequired from "../middleware/auth.js";
import ok from "../utils/response.js";

const router = Router();

/**
 * GET /api/leaderboard
 * Query: ?game=chess     (optional; omit for global)
 *        ?count=20       (default 10, max 100)
 *        ?withUser=1     (include name)
 * Returns: [{ userId, score, name? }, ...]
 */
router.get("/", async (req, res, next) => {
  try {
    const { game, count, withUser } = req.query;
    const countNum  = count  ? Math.min(Number(count), 100) : 10;
    const boardKey  = game ? `game:${game}:lb` : "global:lb";
    const entries   = await getTop(boardKey, countNum, withUser === "1" || withUser === true);
    ok(res).ok({ board: game || "global", count: countNum, entries }).send();
  } catch (err) { next(err); }
});

/**
 * GET /api/leaderboard/rank
 * @auth
 * Query: ?game=chess
 * Returns: { rank: number, userId, name }
 */
router.get("/rank", authRequired, async (req, res, next) => {
  try {
    const { game } = req.query;
    if (!game) return ok(res).badRequest({ field: "game", message: "game query param required" }).send();

    const rank = await getRank(`game:${game}:lb`, req.user.id);
    if (!rank) return ok(res).ok({ rank: null, userId: req.user.id, name: req.user.name }).send();

    const brief = await getUserBrief(req.user.id);
    ok(res).ok({ rank: rank.rank, userId: req.user.id, name: brief.name }).send();
  } catch (err) { next(err); }
});

/**
 * GET /api/leaderboard/around
 * @auth
 * Query: ?game=chess&offset=5
 * Returns: { centreUserId, centreRank, windowSize, entries: [...] }
 */
router.get("/around", authRequired, async (req, res, next) => {
  try {
    const { game, offset } = req.query;
    if (!game) return ok(res).badRequest({ field: "game", message: "game required" }).send();
    const data = await getAroundUser(`game:${game}:lb`, req.user.id, offset ? Number(offset) : 5);
    if (!data) return ok(res).ok({ centreUserId: req.user.id, centreRank: null, windowSize: 0, entries: [] }).send();
    ok(res).ok(data).send();
  } catch (err) { next(err); }
});

/**
 * GET /api/leaderboard/games
 * Returns: [{ key: "chess", name: "chess" }, ...]
 */
router.get("/games", async (req, res, next) => {
  try {
    const games = await getUserGames("");
    // Fallback via sismember if zrevrange trick fails - use getAllGameNames
    const { getAllGameNames } = await import("../db/redis.js");
    const names = await getAllGameNames();
    ok(res).ok(names.map(n => ({ name: n }))).send();
  } catch (err) { next(err); }
});

/**
 * GET /api/leaderboard/top-players
 * Query: ?count=10&period=all|daily|weekly|monthly
 * Returns: { period, totalPlayers, global: [...], perGame: { game: [...] } }
 */
router.get("/top-players", async (req, res, next) => {
  try {
    const { count, period } = req.query;
    const report = await getTopPlayersReport(count ? Number(count) : 10, period || "all");
    ok(res).ok(report).send();
  } catch (err) { next(err); }
});

export default router;
