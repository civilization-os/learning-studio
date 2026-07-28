import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const storePath = process.env.APP_STORE_PATH ?? join(rootDir, "data", "store.json");
let runtimeApiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
let runtimeWebSearchApiKey = process.env.TAVILY_API_KEY?.trim() ?? "";
let apiKeyNeedsProtection = false;
let webSearchApiKeyNeedsProtection = false;

type EncryptedSecrets = {
  deepSeekApiKey?: ProtectedSecret;
  tavilyApiKey?: ProtectedSecret;
};

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

let encryptedSecrets: EncryptedSecrets = {};

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

export async function readStore(): Promise<AppStore> {
  try {
    const raw = await readFile(storePath, "utf8");
    const saved = JSON.parse(raw) as PersistedStore;
    const savedSettings = saved.aiSettings ?? {};
    const savedWebSearchSettings = saved.webSearchSettings ?? {};
    const legacyApiKey =
      "apiKey" in savedSettings && typeof savedSettings.apiKey === "string"
        ? savedSettings.apiKey.trim()
        : "";
    const legacyWebSearchApiKey =
      "apiKey" in savedWebSearchSettings &&
      typeof savedWebSearchSettings.apiKey === "string"
        ? savedWebSearchSettings.apiKey.trim()
        : "";

    const savedDeepSeekSecret = normalizePersistedSecret(
      saved.encryptedSecrets?.deepSeekApiKey,
      saved.encryptedSecrets?.format,
    );
    const savedTavilySecret = normalizePersistedSecret(
      saved.encryptedSecrets?.tavilyApiKey,
      saved.encryptedSecrets?.format,
    );
    encryptedSecrets = {
      ...(savedDeepSeekSecret ? { deepSeekApiKey: savedDeepSeekSecret } : {}),
      ...(savedTavilySecret ? { tavilyApiKey: savedTavilySecret } : {}),
    };

    if (!runtimeApiKey && encryptedSecrets.deepSeekApiKey) {
      try {
        runtimeApiKey = (
          await unprotectSecret(encryptedSecrets.deepSeekApiKey)
        ).trim();
      } catch (error) {
        console.warn(
          "DeepSeek API Key 无法解密：",
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (!runtimeWebSearchApiKey && encryptedSecrets.tavilyApiKey) {
      try {
        runtimeWebSearchApiKey = (
          await unprotectSecret(encryptedSecrets.tavilyApiKey)
        ).trim();
      } catch (error) {
        console.warn(
          "Tavily API Key 无法解密：",
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (!runtimeApiKey && legacyApiKey) {
      runtimeApiKey = legacyApiKey;
      apiKeyNeedsProtection = true;
    }

    if (!runtimeWebSearchApiKey && legacyWebSearchApiKey) {
      runtimeWebSearchApiKey = legacyWebSearchApiKey;
      webSearchApiKeyNeedsProtection = true;
    }

    const store: AppStore = {
      ...defaultStore,
      projects: Array.isArray(saved.projects) ? saved.projects : [],
      aiSettings: {
        ...defaultStore.aiSettings,
        ...savedSettings,
        apiKey: runtimeApiKey || undefined,
      },
      webSearchSettings: {
        ...defaultStore.webSearchSettings,
        ...savedWebSearchSettings,
        apiKey: runtimeWebSearchApiKey || undefined,
      },
    };

    if (legacyApiKey || legacyWebSearchApiKey) {
      if (canPersistSecrets()) {
        await writeStore(store);
      } else {
        apiKeyNeedsProtection = false;
        webSearchApiKeyNeedsProtection = false;
        console.warn(
          "发现旧版明文 API Key，但当前系统没有可用的密钥保护；本次仅在内存中使用，后续写入会移除明文",
        );
      }
    }

    return store;
  } catch {
    await writeStore(defaultStore);
    return {
      ...defaultStore,
      aiSettings: {
        ...defaultStore.aiSettings,
        apiKey: runtimeApiKey || undefined,
      },
      webSearchSettings: {
        ...defaultStore.webSearchSettings,
        apiKey: runtimeWebSearchApiKey || undefined,
      },
    };
  }
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

export async function writeStore(store: AppStore): Promise<void> {
  if (apiKeyNeedsProtection) {
    if (runtimeApiKey) {
      encryptedSecrets.deepSeekApiKey = await protectSecret(runtimeApiKey);
    } else {
      delete encryptedSecrets.deepSeekApiKey;
    }
    apiKeyNeedsProtection = false;
  }

  if (webSearchApiKeyNeedsProtection) {
    if (runtimeWebSearchApiKey) {
      encryptedSecrets.tavilyApiKey = await protectSecret(
        runtimeWebSearchApiKey,
      );
    } else {
      delete encryptedSecrets.tavilyApiKey;
    }
    webSearchApiKeyNeedsProtection = false;
  }

  const { apiKey: _apiKey, ...safeAiSettings } = store.aiSettings;
  const { apiKey: _webSearchApiKey, ...safeWebSearchSettings } = store.webSearchSettings;
  const safeStore = {
    projects: store.projects,
    aiSettings: safeAiSettings,
    webSearchSettings: safeWebSearchSettings,
    ...(encryptedSecrets.deepSeekApiKey || encryptedSecrets.tavilyApiKey
      ? { encryptedSecrets }
      : {}),
  };
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(safeStore, null, 2), "utf8");
}

export function setRuntimeApiKey(apiKey: string): void {
  runtimeApiKey = apiKey.trim();
  apiKeyNeedsProtection = true;
}

export function setRuntimeWebSearchApiKey(apiKey: string): void {
  runtimeWebSearchApiKey = apiKey.trim();
  webSearchApiKeyNeedsProtection = true;
}

export function isApiKeyPersisted(): boolean {
  return Boolean(encryptedSecrets.deepSeekApiKey);
}

export function isWebSearchApiKeyPersisted(): boolean {
  return Boolean(encryptedSecrets.tavilyApiKey);
}

export async function createProject(input: { title: string; description: string }): Promise<LearningProject> {
  const store = await readStore();
  const title = input.title.trim() || "新的学习项目";
  const now = Date.now();
  const project: LearningProject = {
    id: `project-${now}`,
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
  await writeStore(store);
  return project;
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const store = await readStore();
  const nextProjects = store.projects.filter((project) => project.id !== projectId);
  if (nextProjects.length === store.projects.length) return false;
  store.projects = nextProjects;
  await writeStore(store);
  return true;
}
