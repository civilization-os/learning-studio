import type {
  CourseChapter,
  LearningProject,
  LessonContent,
  ModelSettings,
  OutlinePreferences,
  PreferenceRecommendations,
} from "./studyAgent";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

type KeyProtection =
  | "windows-dpapi-current-user"
  | "aes-256-gcm-environment-key"
  | "unavailable";

type AiSettingsResponse = {
  settings: {
    provider: "DeepSeek";
    modelName: ModelSettings["modelName"];
    baseUrl: string;
    apiKeyConfigured: boolean;
    apiKeyPersisted: boolean;
    keyProtection: KeyProtection;
  };
};

type SearchSettingsResponse = {
  settings: {
    provider: "Tavily";
    apiKeyConfigured: boolean;
    apiKeyPersisted: boolean;
    keyProtection: KeyProtection;
  };
};

export type RemoteModel = {
  id: string;
  ownedBy: string;
};

type OutlineGenerationResponse = {
  project: LearningProject;
  summary: string;
  data: {
    webSearchUsed?: boolean;
    warning?: string;
    mode?: "generate" | "polish";
    polishedCount?: number;
  };
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("无法连接本地后端，请重新执行 npm.cmd run dev 后再试。");
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || `请求失败（${response.status}）`);
  }

  return data;
}

export async function createRemoteProject(input: {
  topic: string;
  description: string;
}): Promise<LearningProject> {
  const result = await apiRequest<{ project: LearningProject }>("/projects", {
    method: "POST",
    body: JSON.stringify({
      title: input.topic,
      description: input.description,
    }),
  });
  return result.project;
}

export async function generateRemoteProjectDescription(
  topic: string,
): Promise<string> {
  const result = await apiRequest<{ description: string }>(
    "/projects/generate-description",
    {
      method: "POST",
      body: JSON.stringify({ topic: topic.trim() }),
    },
  );
  return result.description;
}

export async function getRemotePreferenceRecommendations(
  topic: string,
  description: string,
): Promise<PreferenceRecommendations> {
  const result = await apiRequest<{
    recommendations: PreferenceRecommendations;
  }>("/projects/suggest-preferences", {
    method: "POST",
    body: JSON.stringify({
      topic: topic.trim(),
      description: description.trim(),
    }),
  });
  return result.recommendations;
}

export async function generateRemoteOutline(
  projectId: string,
  mode: "generate" | "optimize" = "generate",
  preferences?: OutlinePreferences,
): Promise<OutlineGenerationResponse> {
  return apiRequest<OutlineGenerationResponse>(
    `/projects/${encodeURIComponent(projectId)}/generate-outline`,
    {
      method: "POST",
      body: JSON.stringify({ mode, preferences }),
    },
  );
}

export async function saveRemoteOutline(projectId: string, chapters: CourseChapter[]): Promise<void> {
  await apiRequest(`/projects/${encodeURIComponent(projectId)}/outline`, {
    method: "PUT",
    body: JSON.stringify({ chapters }),
  });
}

export async function generateRemoteLesson(
  projectId: string,
  sectionId: string,
  force = false,
): Promise<{
  project: LearningProject;
  content: LessonContent;
  cached: boolean;
  summary: string;
  webSearchUsed?: boolean;
  sourceCount?: number;
  warning?: string;
}> {
  return apiRequest(
    `/projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(sectionId)}/generate-content`,
    {
      method: "POST",
      body: JSON.stringify({ force }),
    },
  );
}

export type TutorHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export async function askRemoteTutor(
  projectId: string,
  sectionId: string,
  message: string,
  history: TutorHistoryItem[],
  learningContext?: {
    phase: "orient" | "understand" | "practice" | "reflect";
    attempt: "idle" | "correct" | "incorrect";
    confidence: "uncertain" | "partial" | "ready" | null;
  },
): Promise<{
  answer: string;
  suggestions: string[];
  recommendedAction?: string;
}> {
  return apiRequest(
    `/projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(sectionId)}/tutor`,
    {
      method: "POST",
      body: JSON.stringify({ message, history, learningContext }),
    },
  );
}

export async function completeRemoteSection(
  projectId: string,
  sectionId: string,
): Promise<{
  project: LearningProject;
  next: { chapterId: string; sectionId: string } | null;
}> {
  return apiRequest(
    `/projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(sectionId)}/complete`,
    {
      method: "POST",
    },
  );
}

export async function getRemoteAiSettings(): Promise<AiSettingsResponse["settings"]> {
  const result = await apiRequest<AiSettingsResponse>("/settings/ai");
  return result.settings;
}

export async function getRemoteModels(): Promise<RemoteModel[]> {
  const result = await apiRequest<{ models: RemoteModel[] }>("/models");
  return result.models;
}

export async function updateRemoteAiSettings(
  settings: Pick<ModelSettings, "modelName" | "baseUrl" | "apiKey">,
): Promise<AiSettingsResponse["settings"]> {
  const result = await apiRequest<AiSettingsResponse>("/settings/ai", {
    method: "PUT",
    body: JSON.stringify({
      ...(settings.modelName.trim() ? { modelName: settings.modelName.trim() } : {}),
      baseUrl: settings.baseUrl,
      ...(settings.apiKey.trim() ? { apiKey: settings.apiKey.trim() } : {}),
    }),
  });
  return result.settings;
}

export async function getRemoteSearchSettings(): Promise<SearchSettingsResponse["settings"]> {
  const result = await apiRequest<SearchSettingsResponse>("/settings/search");
  return result.settings;
}

export async function updateRemoteSearchSettings(
  apiKey: string,
): Promise<SearchSettingsResponse["settings"]> {
  const result = await apiRequest<SearchSettingsResponse>("/settings/search", {
    method: "PUT",
    body: JSON.stringify(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
  });
  return result.settings;
}

export async function testRemoteSearchConnection(
  apiKey: string,
): Promise<{
  webSearchUsed: boolean;
  warning?: string;
  apiKeyConfigured: boolean;
  apiKeyPersisted: boolean;
}> {
  const settings = await updateRemoteSearchSettings(apiKey);
  const result = await apiRequest<{ webSearchUsed: boolean; warning?: string }>("/search/test", {
    method: "POST",
  });
  return {
    ...result,
    apiKeyConfigured: settings.apiKeyConfigured,
    apiKeyPersisted: settings.apiKeyPersisted,
  };
}

export async function testRemoteAiConnection(
  settings: Pick<ModelSettings, "modelName" | "baseUrl" | "apiKey">,
): Promise<{
  content: string;
  mocked: boolean;
  apiKeyConfigured: boolean;
  apiKeyPersisted: boolean;
}> {
  const savedSettings = await updateRemoteAiSettings(settings);
  const result = await apiRequest<{ content: string; mocked: boolean }>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message: "请只回复：连接正常" }),
  });
  return {
    ...result,
    apiKeyConfigured: savedSettings.apiKeyConfigured,
    apiKeyPersisted: savedSettings.apiKeyPersisted,
  };
}
