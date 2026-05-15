import { verify } from "jsonwebtoken";
import { JWT_SECRET } from "../config.js";

/**
 * Uses req.headers.authorization (Bearer <token>) to attach req.user.
 * Skips if no token is present (pass-through) — use {@link authRequired} for protected routes.
 */
export default function authOptional(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.split(" ")[1];
  if (!token) return next();
  verify(token, JWT_SECRET, (err, payload) => {
    if (err) return next();
    req.user = payload;          // { id, iat, exp }
    next();
  });
}

/**
 * Requires a valid JWT Bearer token. Responds 401 immediately on failure.
 */
export const authRequired = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token  = header.split(" ")[1];
  if (!token) return res.status(401).json({
    success: false,
    error: "UNAUTHORIZED",
    message: "Missing Authorization header. Use: Bearer <token>"
  });
  verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(401).json({
      success: false,
      error: "UNAUTHORIZED",
      message: "Invalid or expired token"
    });
    req.user = payload;
    next();
  });
};
