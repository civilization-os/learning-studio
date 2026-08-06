import {
  canPersistSecrets,
  isSecretProtectionFormat,
  protectSecret,
  ProtectedSecret,
  SecretProtectionFormat,
  unprotectSecret,
} from "./secret-protection.js";
import {
  AiSettings,
  AppStore,
  LearningProject,
  WebSearchSettings,
} from "./types.js";
import { db } from "./db/index.js";
import { projects, userSettings } from "./db/schema.js";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

type EncryptedSecrets = {
  deepSeekApiKey?: ProtectedSecret;
  tavilyApiKey?: ProtectedSecret;
};

const defaultStore: AppStore = {
  aiSettings: {
    provider: "DeepSeek",
    modelName: "",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  },
  webSearchSettings: {
    provider: "Tavily",
  },
  projects: [],
};

const environmentApiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
const environmentWebSearchApiKey = process.env.TAVILY_API_KEY?.trim() ?? "";

export async function readStore(userId: string): Promise<AppStore> {
  if (!userId) throw new Error("readStore requires userId");

  const dbSettings = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();

  const savedSettings = (dbSettings?.aiSettings as Partial<AiSettings>) ?? {};
  const savedWebSearchSettings = (dbSettings?.webSearchSettings as Partial<WebSearchSettings>) ?? {};
  const savedEncryptedSecrets = (dbSettings?.encryptedSecrets as EncryptedSecrets) ?? {};

  let currentRuntimeApiKey = environmentApiKey;
  let currentRuntimeWebSearchApiKey = environmentWebSearchApiKey;

  if (!currentRuntimeApiKey && savedEncryptedSecrets.deepSeekApiKey) {
    try {
      currentRuntimeApiKey = (await unprotectSecret(savedEncryptedSecrets.deepSeekApiKey)).trim();
    } catch (error) {
      console.warn("DeepSeek API Key 无法解密：", error instanceof Error ? error.message : error);
    }
  }

  if (!currentRuntimeWebSearchApiKey && savedEncryptedSecrets.tavilyApiKey) {
    try {
      currentRuntimeWebSearchApiKey = (await unprotectSecret(savedEncryptedSecrets.tavilyApiKey)).trim();
    } catch (error) {
      console.warn("Tavily API Key 无法解密：", error instanceof Error ? error.message : error);
    }
  }

  const dbProjects = db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt)).all();
  const loadedProjects = dbProjects.map(p => p.data as unknown as LearningProject);

  return {
    ...defaultStore,
    projects: loadedProjects,
    aiSettings: {
      ...defaultStore.aiSettings,
      ...savedSettings,
      apiKey: currentRuntimeApiKey || undefined,
    },
    webSearchSettings: {
      ...defaultStore.webSearchSettings,
      ...savedWebSearchSettings,
      apiKey: currentRuntimeWebSearchApiKey || undefined,
    },
  };
}

export async function writeStore(userId: string, store: AppStore): Promise<void> {
  if (!userId) throw new Error("writeStore requires userId");

  const currentSettings = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
  const encryptedSecrets: EncryptedSecrets = (currentSettings?.encryptedSecrets as EncryptedSecrets) ?? {};

  const runtimeKey = store.aiSettings.apiKey;
  const webSearchKey = store.webSearchSettings.apiKey;

  if (runtimeKey && runtimeKey !== environmentApiKey) {
    encryptedSecrets.deepSeekApiKey = await protectSecret(runtimeKey);
  } else if (!runtimeKey) {
    delete encryptedSecrets.deepSeekApiKey;
  }

  if (webSearchKey && webSearchKey !== environmentWebSearchApiKey) {
    encryptedSecrets.tavilyApiKey = await protectSecret(webSearchKey);
  } else if (!webSearchKey) {
    delete encryptedSecrets.tavilyApiKey;
  }

  const { apiKey: _apiKey, ...safeAiSettings } = store.aiSettings;
  const { apiKey: _webSearchApiKey, ...safeWebSearchSettings } = store.webSearchSettings;

  if (currentSettings) {
    db.update(userSettings).set({
      aiSettings: safeAiSettings,
      webSearchSettings: safeWebSearchSettings,
      encryptedSecrets: encryptedSecrets,
    }).where(eq(userSettings.userId, userId)).run();
  } else {
    db.insert(userSettings).values({
      userId,
      aiSettings: safeAiSettings,
      webSearchSettings: safeWebSearchSettings,
      encryptedSecrets: encryptedSecrets,
    }).run();
  }

  for (const proj of store.projects) {
    const ownedProject = and(
      eq(projects.id, proj.id),
      eq(projects.userId, userId),
    );
    const existing = db.select().from(projects).where(ownedProject).get();
    if (existing) {
      db.update(projects).set({
        title: proj.title,
        description: proj.description,
        data: proj,
        updatedAt: new Date(),
      }).where(ownedProject).run();
    } else {
      db.insert(projects).values({
        id: proj.id,
        userId,
        title: proj.title,
        description: proj.description,
        data: proj,
        updatedAt: new Date(),
      }).run();
    }
  }

  const incomingIds = new Set(store.projects.map(p => p.id));
  const existingProjects = db.select().from(projects).where(eq(projects.userId, userId)).all();
  for (const dbProj of existingProjects) {
    if (!incomingIds.has(dbProj.id)) {
      db.delete(projects)
        .where(and(eq(projects.id, dbProj.id), eq(projects.userId, userId)))
        .run();
    }
  }
}

export function isApiKeyPersisted(userId: string): boolean {
  if (environmentApiKey) return true;
  const settings = db
    .select({ encryptedSecrets: userSettings.encryptedSecrets })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .get();
  const secrets = (settings?.encryptedSecrets as EncryptedSecrets) ?? {};
  return Boolean(secrets.deepSeekApiKey);
}

export function isWebSearchApiKeyPersisted(userId: string): boolean {
  if (environmentWebSearchApiKey) return true;
  const settings = db
    .select({ encryptedSecrets: userSettings.encryptedSecrets })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .get();
  const secrets = (settings?.encryptedSecrets as EncryptedSecrets) ?? {};
  return Boolean(secrets.tavilyApiKey);
}

export async function createProject(userId: string, input: { title: string; description: string }): Promise<LearningProject> {
  const store = await readStore(userId);
  const title = input.title.trim() || "新的学习项目";
  const now = Date.now();
  const projectId = `project-${randomUUID()}`;
  const project: LearningProject = {
    id: projectId,
    title,
    description: input.description.trim() || `围绕「${title}」生成学习路径。`,
    progress: 0,
    lastStudied: "刚刚创建",
    pendingTasks: 0,
    weeklyMinutes: 0,
    accuracy: 0,
    weakPoints: [],
    chapters: [
      {
        id: `chapter-${now}-1`,
        title: "第一章 基础认知",
        origin: "ai",
        sections: [
          { id: `section-${now}-1`, title: "核心概念", status: "current", origin: "ai" },
          { id: `section-${now}-2`, title: "基本方法", status: "locked", origin: "ai" },
        ],
      },
    ],
  };

  store.projects = [project, ...store.projects];
  await writeStore(userId, store);
  return project;
}

export async function deleteProject(userId: string, projectId: string): Promise<boolean> {
  const store = await readStore(userId);
  const nextProjects = store.projects.filter((project) => project.id !== projectId);
  if (nextProjects.length === store.projects.length) return false;
  store.projects = nextProjects;
  await writeStore(userId, store);
  return true;
}
