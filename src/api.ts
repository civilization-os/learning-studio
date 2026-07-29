import type {
  CourseChapter,
  ChapterToolLibrary,
  LearningProject,
  LessonContent,
  LessonProgress,
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

export type GenerationTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationTask = {
  id: string;
  type:
    | "project-description"
    | "preference-suggestions"
    | "course-outline"
    | "outline-polish"
    | "lesson-content"
    | "chapter-tool-library"
    | "tutor-reply"
    | "exercise"
    | "agent-run"
    | "connection-test";
  title: string;
  projectId?: string;
  chapterId?: string;
  sectionId?: string;
  status: GenerationTaskStatus;
  stage: string;
  detail?: string;
  progress?: number;
  completedUnits?: number;
  totalUnits?: number;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
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

async function createGenerationTask(input: {
  type: GenerationTask["type"];
  title: string;
  projectId?: string;
  chapterId?: string;
  sectionId?: string;
}) {
  const result = await apiRequest<{ task: GenerationTask }>(
    "/generation-tasks",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.task;
}

async function trackedApiRequest<T>(
  path: string,
  task: {
    type: GenerationTask["type"];
    title: string;
    projectId?: string;
    chapterId?: string;
    sectionId?: string;
  },
  init?: RequestInit,
): Promise<T> {
  let generationTask: GenerationTask | undefined;
  try {
    generationTask = await createGenerationTask(task);
  } catch {
    // Keep compatibility with a server that has not restarted onto the new API yet.
  }
  return apiRequest<T>(path, {
    ...init,
    headers: {
      ...init?.headers,
      ...(generationTask
        ? { "X-Generation-Task-Id": generationTask.id }
        : {}),
    },
  });
}

export function subscribeGenerationTasks(
  onTasks: (tasks: GenerationTask[]) => void,
) {
  const tasks = new Map<string, GenerationTask>();
  const source = new EventSource(`${API_BASE_URL}/generation-tasks/events`);
  const emit = () => {
    onTasks(
      Array.from(tasks.values()).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
  };
  const handleSnapshot = (event: Event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as {
      tasks?: GenerationTask[];
    };
    tasks.clear();
    for (const task of payload.tasks ?? []) tasks.set(task.id, task);
    emit();
  };
  const handleTask = (event: Event) => {
    const task = JSON.parse(
      (event as MessageEvent<string>).data,
    ) as GenerationTask;
    tasks.set(task.id, task);
    emit();
  };
  source.addEventListener("snapshot", handleSnapshot);
  source.addEventListener("task", handleTask);
  return () => {
    source.removeEventListener("snapshot", handleSnapshot);
    source.removeEventListener("task", handleTask);
    source.close();
  };
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

export async function deleteRemoteProject(
  projectId: string,
): Promise<{ projectId: string; deleted: boolean }> {
  return apiRequest(`/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

export async function generateRemoteProjectDescription(
  topic: string,
): Promise<string> {
  const result = await trackedApiRequest<{ description: string }>(
    "/projects/generate-description",
    {
      type: "project-description",
      title: `补充“${topic.trim()}”的内容描述`,
    },
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
  const result = await trackedApiRequest<{
    recommendations: PreferenceRecommendations;
  }>(
    "/projects/suggest-preferences",
    {
      type: "preference-suggestions",
      title: `判断“${topic.trim()}”适合怎样学习`,
    },
    {
      method: "POST",
      body: JSON.stringify({
        topic: topic.trim(),
        description: description.trim(),
      }),
    },
  );
  return result.recommendations;
}

export async function generateRemoteOutline(
  projectId: string,
  mode: "generate" | "optimize" = "generate",
  preferences?: OutlinePreferences,
): Promise<OutlineGenerationResponse> {
  return trackedApiRequest<OutlineGenerationResponse>(
    `/projects/${encodeURIComponent(projectId)}/generate-outline`,
    {
      type: mode === "optimize" ? "outline-polish" : "course-outline",
      title:
        mode === "optimize" ? "整理大纲新增节点" : "重新规划学习路线",
      projectId,
    },
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
  return trackedApiRequest(
    `/projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(sectionId)}/generate-content`,
    {
      type: "lesson-content",
      title: force ? "检查并更新本节课堂" : "准备本节课堂",
      projectId,
      sectionId,
    },
    {
      method: "POST",
      body: JSON.stringify({ force }),
    },
  );
}

export async function generateRemoteChapterToolLibrary(
  projectId: string,
  chapterId: string,
  force = false,
): Promise<{
  project: LearningProject;
  toolLibrary: ChapterToolLibrary;
  cached: boolean;
  summary: string;
  warning?: string;
}> {
  return trackedApiRequest(
    `/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/generate-tool-library`,
    {
      type: "chapter-tool-library",
      title: force ? "重新整理本章工具" : "整理本章工具",
      projectId,
      chapterId,
    },
    {
      method: "POST",
      body: JSON.stringify({ force }),
    },
  );
}

export async function saveRemoteLessonProgress(
  projectId: string,
  sectionId: string,
  progress: LessonProgress,
): Promise<{
  project: LearningProject;
  progress: LessonProgress;
}> {
  return apiRequest(
    `/projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(sectionId)}/progress`,
    {
      method: "PUT",
      body: JSON.stringify({ progress }),
    },
  );
}

export type TutorHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type TutorSceneContext = {
  sceneId: string;
  selectedIndex?: number;
  correct?: boolean;
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
    scene?: TutorSceneContext;
  },
): Promise<{
  answer: string;
  suggestions: string[];
  recommendedAction?: string;
}> {
  return trackedApiRequest(
    `/projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(sectionId)}/tutor`,
    {
      type: "tutor-reply",
      title: "助教正在结合当前课堂回答",
      projectId,
      sectionId,
    },
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
  const result = await trackedApiRequest<{ content: string; mocked: boolean }>(
    "/ai/chat",
    {
      type: "connection-test",
      title: "测试内容服务连接",
    },
    {
      method: "POST",
      body: JSON.stringify({ message: "请只回复：连接正常" }),
    },
  );
  return {
    ...result,
    apiKeyConfigured: savedSettings.apiKeyConfigured,
    apiKeyPersisted: savedSettings.apiKeyPersisted,
  };
}
