import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { eq, lt } from "drizzle-orm";
import { db } from "./db/index.js";
import { verificationCodes } from "./db/schema.js";

const codeLifetimeMs = 10 * 60 * 1000;
const resendDelayMs = 60 * 1000;
const recentDeliveries = new Map<string, number>();

function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createTransport() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS ?? "",
          },
        }
      : {}),
  });
}

export async function sendRegistrationCode(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw new Error("请输入有效的邮箱地址");
  }

  const now = Date.now();
  const lastDelivery = recentDeliveries.get(email) ?? 0;
  if (now - lastDelivery < resendDelayMs) {
    const remainingSeconds = Math.ceil((resendDelayMs - (now - lastDelivery)) / 1000);
    throw new Error(`请在 ${remainingSeconds} 秒后重新发送`);
  }

  db.delete(verificationCodes)
    .where(lt(verificationCodes.expiresAt, new Date(now)))
    .run();

  const code = crypto.randomInt(100000, 1000000).toString();
  db.insert(verificationCodes)
    .values({ email, code, expiresAt: new Date(now + codeLifetimeMs) })
    .onConflictDoUpdate({
      target: verificationCodes.email,
      set: { code, expiresAt: new Date(now + codeLifetimeMs) },
    })
    .run();

  const transport = createTransport();
  if (transport) {
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@localhost",
      to: email,
      subject: "圆趣学习注册验证码",
      text: `您的注册验证码是 ${code}，10 分钟内有效。`,
      html: `<p>您的注册验证码是 <strong>${code}</strong>，10 分钟内有效。</p>`,
    });
  } else if (process.env.NODE_ENV === "production") {
    db.delete(verificationCodes).where(eq(verificationCodes.email, email)).run();
    throw new Error("邮件服务尚未配置，请联系管理员");
  } else {
    console.info(`[auth] ${email} 的本地开发验证码：${code}`);
  }

  recentDeliveries.set(email, now);
  return {
    email,
    ...(transport ? {} : { devCode: code }),
  };
}
