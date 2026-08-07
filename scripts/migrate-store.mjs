#!/usr/bin/env node
// 手动迁移旧版 store.json 数据到指定用户。
// 用法(需先编译):
//   npm run server:build
//   node scripts/migrate-store.mjs --email user@example.com
//   node scripts/migrate-store.mjs --username alice
// 说明:正常部署无需手动执行——注册接口会自动把 store.json 迁移给第一个注册的账号。
// 若旧数据应归某个已存在的用户,用本脚本指定目标账号。
import { eq } from "drizzle-orm";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
function argValue(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}
const email = argValue("--email");
const username = argValue("--username");
if (!email && !username) {
  console.error(
    "用法: node scripts/migrate-store.mjs --email <邮箱> 或 --username <用户名>",
  );
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { db } = await import(pathToFileURL(join(root, "server/dist/db/index.js")));
const { users } = await import(
  pathToFileURL(join(root, "server/dist/db/schema.js")),
);
const { migrateLegacyStoreIfPresent } = await import(
  pathToFileURL(join(root, "server/dist/legacy-migration.js")),
);

const condition = email
  ? eq(users.email, email.toLowerCase().trim())
  : eq(users.username, username.trim());
const user = db.select().from(users).where(condition).get();
if (!user) {
  console.error(`未找到用户: ${email ? `email=${email}` : `username=${username}`}`);
  process.exit(1);
}

const migrated = await migrateLegacyStoreIfPresent(user.id);
console.log(
  migrated
    ? `已将 store.json 数据迁移到用户 ${user.username} (${user.id})`
    : "未发现待迁移的 store.json(可能已迁移过)",
);
