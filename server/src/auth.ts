import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const configuredJwtSecret = process.env.JWT_SECRET?.trim();
if (!configuredJwtSecret && process.env.NODE_ENV === "production") {
  throw new Error("生产环境必须配置 JWT_SECRET");
}

const JWT_SECRET =
  configuredJwtSecret ?? "learning-studio-local-development-secret";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return typeof payload === "object" && typeof payload.userId === "string"
      ? { userId: payload.userId }
      : null;
  } catch {
    return null;
  }
}
