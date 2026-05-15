import express  from "express";
import cors     from "cors";
import { PORT } from "./config.js";

import authRoutes       from "./routes/auth.js";
import scoreRoutes      from "./routes/scores.js";
import leaderboardRoutes from "./routes/leaderboard.js";

import errorHandler from "./middleware/errorHandler.js";

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors());

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", service: "leaderboard" }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",       authRoutes);
app.use("/api/scores",     scoreRoutes);
app.use("/api/leaderboard",leaderboardRoutes);

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, error: "NOT_FOUND" }));

// ── Error handler (must be registered last) ───────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () =>
  console.log(`[server] http://localhost:${PORT}  |  GET http://localhost:${PORT}/health`));
