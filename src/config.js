import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
export const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
export const REDIS_URL = process.env.REDIS_URL  || "redis://127.0.0.1:6379";
