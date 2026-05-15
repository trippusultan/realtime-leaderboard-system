import { Router } from "express";
import { body } from "express-validator";
import { createUser, findByEmail } from "../db/redis.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config.js";
import ok from "../utils/response.js";

const router = Router();

const registerBody = [
  body("name").trim().isLength({ min: 2 }).withMessage("name must be ≥ 2 chars"),
  body("email").trim().isEmail().normalizeEmail(),
  body("password").isLength({ min: 6 }).withMessage("password must be ≥ 6 chars"),
];

/**
 * POST /api/auth/register
 * Body: { name, email, password }
 * Returns: { token, user: { id, name, email } }
 */
router.post("/register", registerBody, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const { id, ...user } = await createUser({ name, email, plainPassword: password });
    const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    ok(res).created({ token, user }).send();
  } catch (err) {
    if (err.type === "CONFLICT") return ok(res).conflict(err.details).send();
    next(err);
  }
});

const loginBody = [
  body("email").trim().isEmail().normalizeEmail(),
  body("password").notEmpty(),
];

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { token, user: { id, name, email } }
 */
router.post("/login", loginBody, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const userRecord = await findByEmail(email);
    if (!userRecord) return ok(res).unauthorized({ field: "email", message: "Invalid credentials" }).send();

    const valid = await bcrypt.compare(password, userRecord.password_hash);
    if (!valid) return ok(res).unauthorized({ field: "password", message: "Invalid credentials" }).send();

    const token = jwt.sign({ id: userRecord.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    ok(res).ok({ token, user: { id: userRecord.id, name: userRecord.name, email: userRecord.email } }).send();
  } catch (err) {
    next(err);
  }
});

export default router;
