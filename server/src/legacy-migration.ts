import { existsSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { projects, userSettings } from "./db/schema.js";
import { AiSettings, LearningProject, WebSearchSettings } from "./types.js";
import {
  isSecretProtectionFormat,
  ProtectedSecret,
  SecretProtectionFormat,
} from "./secret-protection.js";

/**
 * 旧版(单用户时代)store.json 的数据结构。
 * 参见旧版 server/src/store.ts 的 PersistedStore。
 */
type PersistedEncryptedSecrets = {
  format?: SecretProtectionFormat;
  deepSeekApiKey?: string | Partial<ProtectedSecret>;
  tavilyApiKey?: string | Partial<ProtectedSecret>;
};

type PersistedStore = {
  projects?: LearningProject[];
  aiSettings?: Partial<AiSettings>;
  webSearchSettings?: Partial<WebSearchSettings>;
  encryptedSecrets?: PersistedEncryptedSecrets;
};

/** 探测旧版 store.json 所在位置:
 *  - 显式 APP_STORE_PATH 存在时优先使用
 *  - 显式路径已被迁移过(存在 .migrated)时视为已完成,返回 null
 *  - 显式路径缺失且未迁移过时,按默认位置探测(旧默认 server/data、当前工作目录 data),
 *    兼容旧容器数据落在 server/data 的场景;此时会打警告日志
 */
export function findLegacyStorePath(): string | null {
  const explicit = process.env.APP_STORE_PATH?.trim();
  if (explicit) {
    if (existsSync(explicit)) return explicit;
    if (existsSync(`${explicit}.migrated`)) return null; // 已迁移过
    console.warn(
      `[migration] APP_STORE_PATH 指向的文件不存在(${explicit}),将按默认位置探测 store.json`,
    );
  }
  const defaults = [
    // 旧版默认路径:server/data/store.json(源码 src/ 与编译后 dist/ 上一级都是 server/)
    join(dirname(dirname(fileURLToPath(import.meta.url))), "data", "store.json"),
    join(process.cwd(), "data", "store.json"),
  ];
  return defaults.find((p) => existsSync(p)) ?? null;
}

function normalizePersistedSecret(
  value: string | Partial<ProtectedSecret> | undefined,
  legacyFormat: SecretProtectionFormat | undefined,
): ProtectedSecret | undefined {
  if (typeof value === "string" && isSecretProtectionFormat(legacyFormat)) {
    return { format: legacyFormat, value };
  }
  if (
    value &&
    typeof value === "object" &&
    isSecretProtectionFormat(value.format) &&
    typeof value.value === "string" &&
    value.value
  ) {
    return { format: value.format, value: value.value };
  }
  return undefined;
}

/**
 * 一次性迁移:把旧版 store.json 的数据导入指定用户的 SQLite 记录。
 * - 调用时机:新用户注册成功后(旧数据将归第一个注册的账号)
 * - 幂等:迁移成功后把 store.json 重命名为 store.json.migrated,不会重复导入
 * - 返回是否发生了迁移
 */
export async function migrateLegacyStoreIfPresent(userId: string): Promise<boolean> {
  const storePath = findLegacyStorePath();
  if (!storePath) return false;

  let saved: PersistedStore;
  try {
    saved = JSON.parse(readFileSync(storePath, "utf8")) as PersistedStore;
  } catch (error) {
    console.warn(`[migration] store.json 解析失败,跳过迁移: ${storePath}`);
    console.warn(error instanceof Error ? error.message : error);
    return false;
  }

  // 1) 项目
  const projectList = Array.isArray(saved.projects) ? saved.projects : [];
  for (const proj of projectList) {
    const owned = and(eq(projects.id, proj.id), eq(projects.userId, userId));
    const existing = db.select().from(projects).where(owned).get();
    if (existing) {
      db.update(projects)
        .set({
          title: proj.title,
          description: proj.description,
          data: proj,
          updatedAt: new Date(),
        })
        .where(owned)
        .run();
    } else {
      db.insert(projects)
        .values({
          id: proj.id,
          userId,
          title: proj.title,
          description: proj.description,
          data: proj,
          updatedAt: new Date(),
        })
        .run();
    }
  }

  // 2) AI / 搜索设置(去除可能的明文 apiKey 字段,与新 writeStore 行为一致)
  const { apiKey: _rawKey, ...safeAiSettings } = saved.aiSettings ?? {};
  const { apiKey: _rawWebKey, ...safeWebSearchSettings } = saved.webSearchSettings ?? {};

  // 3) 已加密密钥(旧格式原样保留,readStore 时按格式解密)
  const secrets = saved.encryptedSecrets ?? {};
  const encryptedSecrets = {
    ...(normalizePersistedSecret(secrets.deepSeekApiKey, secrets.format)
      ? { deepSeekApiKey: normalizePersistedSecret(secrets.deepSeekApiKey, secrets.format) }
      : {}),
    ...(normalizePersistedSecret(secrets.tavilyApiKey, secrets.format)
      ? { tavilyApiKey: normalizePersistedSecret(secrets.tavilyApiKey, secrets.format) }
      : {}),
  } as Record<string, ProtectedSecret>;

  const hasSettings = Object.keys(safeAiSettings).length > 0 ||
    Object.keys(safeWebSearchSettings).length > 0 ||
    Object.keys(encryptedSecrets).length > 0;

  if (hasSettings) {
    const existingSettings = db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .get();
    if (existingSettings) {
      db.update(userSettings)
        .set({
          aiSettings: safeAiSettings as Partial<AiSettings>,
          webSearchSettings: safeWebSearchSettings as Partial<WebSearchSettings>,
          encryptedSecrets,
        })
        .where(eq(userSettings.userId, userId))
        .run();
    } else {
      db.insert(userSettings)
        .values({
          userId,
          aiSettings: safeAiSettings as Partial<AiSettings>,
          webSearchSettings: safeWebSearchSettings as Partial<WebSearchSettings>,
          encryptedSecrets,
        })
        .run();
    }
  }

  // 4) 标记迁移完成(改名防止重复导入)
  renameSync(storePath, `${storePath}.migrated`);
  console.info(
    `[migration] 已将旧版 store.json 迁移到用户 ${userId}:${projectList.length} 个项目,${Object.keys(encryptedSecrets).length} 组加密密钥`,
  );
  return true;
}
