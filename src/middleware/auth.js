import { JWT_SECRET } from "../config.js";

// ── Boot CJS deps eagerly at the TOP LEVEL ───────────────────────────────────
// `await import(...)` is valid at ESM module scope.
// Both variables are synchronously available before any request arrives.
let _jwtPkg, _bcPkg;
const jwtVerify = (await (async () => {
  const [{ default: j }, { default: b }] = await Promise.all([
    import("jsonwebtoken"),
    import("bcryptjs"),
  ]);
  _jwtPkg = j; _bcPkg = b;
  return j.verify;
})());

const bcCompare = (await (async () => _bcPkg ? _bcPkg.compare : (await import("bcryptjs")).default.compare)());

/**
 * Leaves req.user = { id, iat, exp } if token is present and valid.
 */
export default function authOptional(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.split(" ")[1];
  if (!token) return next();
  try {
    req.user = jwtVerify(token, JWT_SECRET);
  } catch { /* ignore invalid tokens on optional routes */ }
  next();
}

/**
 * Requires a valid JWT Bearer token. 401 on missing / invalid.
 */
// async so Express awaits it before calling the next handler
export const authRequired = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token  = header.split(" ")[1];
  if (!token) return res.status(401).json({
    success: false, error: "UNAUTHORIZED",
    message: "Missing Authorization header. Use: Bearer <token>"
  });
  try {
    req.user = jwtVerify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({
      success: false, error: "UNAUTHORIZED",
      message: "Invalid or expired token"
    });
  }
  // req.user set – proceed to route handler
  next();
};
