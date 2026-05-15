import { Router } from "express";
import { body } from "express-validator";
import { addScore, getScoreHistory, getUserBrief, getRank } from "../db/redis.js";
import { authRequired } from "../middleware/auth.js";
import ok from "../utils/response.js";

const router = Router();

/**
 * POST /api/scores
 * @auth
 * Body: { game: "chess", score: 1500 }
 * Returns: { game, score, timestamp_ms, rank: number }
 */
const submitBody = [
  body("game").trim().notEmpty().isLength({ min: 1 }),
  body("score").isInt({ min: -1_000_000, max: 1_000_000_000 })
    .withMessage("score must be an integer between -1,000,000 and 1,000,000,000"),
];

router.post("/", authRequired, submitBody, async (req, res, next) => {
  try {
    const { game, score } = req.body;
    const result = await addScore(game, req.user.id, score);

    // Return current rank immediately
    const rank = await getRank(`game:${game}:lb`, req.user.id);
    ok(res).created({ ...result, rank: rank ? rank.rank : null }).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/scores/history
 * @auth
 * Query:  ?game=chess          (optional — if omitted returns all games)
 * Returns: [{ game, timestamp_ms, score }, ...]
 */
router.get("/history", authRequired, async (req, res, next) => {
  try {
    const { game } = req.query;
    const { getAllGameNames } = await import("../db/redis.js");
    const games = game ? [game] : [...(await getAllGameNames())];

    const all = [];
    for (const g of games) {
      const entries = await getScoreHistory(req.user.id, g);
      for (const e of entries) all.push({ game: g, ...e });
    }
    all.sort((a, b) => b.timestamp_ms - a.timestamp_ms);
    ok(res).ok(all).send();
  } catch (err) {
    next(err);
  }
});

export default router;
