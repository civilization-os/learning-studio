import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { listAgents, runAgent } from "./agents/index.js";
import { callDeepSeek, listDeepSeekModels } from "./deepseek.js";
import {
  createProject,
  isApiKeyPersisted,
  isWebSearchApiKeyPersisted,
  readStore,
  setRuntimeApiKey,
  setRuntimeWebSearchApiKey,
  writeStore,
} from "./store.js";
import {
  AgentName,
  AiSettings,
  CourseChapter,
  LessonContent,
  LearningProject,
  OutlineAudit,
  OutlinePlan,
  OutlinePolishPatch,
  OutlinePreferences,
  WebSource,
} from "./types.js";
import { searchWeb } from "./webSearch.js";
import {
  canPersistSecrets,
  getSecretProtectionStatus,
} from "./secret-protection.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const maxBodyBytes = 1_000_000;
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const allowedAiOrigins = new Set(
  (process.env.DEEPSEEK_ALLOWED_ORIGINS ?? "https://api.deepseek.com")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin),
);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.length;
    if (size > maxBodyBytes) {
      throw new HttpError(413, "请求内容过大");
    }
    chunks.push(bytes);
  }
  const text = new TextDecoder().decode(concat(chunks));
  try {
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    throw new HttpError(400, "JSON 格式无效");
  }
}

function concat(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function getProjectId(pathname: string, suffix = "") {
  const pattern = suffix ? new RegExp(`^/api/projects/([^/]+)/${suffix}$`) : /^\/api\/projects\/([^/]+)$/;
  return pathname.match(pattern)?.[1];
}

function getSectionRoute(pathname: string, action: string) {
  const match = pathname.match(
    new RegExp(`^/api/projects/([^/]+)/sections/([^/]+)/${action}$`),
  );
  return match
    ? {
        projectId: decodeURIComponent(match[1]),
        sectionId: decodeURIComponent(match[2]),
      }
    : null;
}

function normaliseAiBaseUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "Base URL 格式无效");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "Base URL 格式无效");
  }

  if (url.protocol !== "https:" || !allowedAiOrigins.has(url.origin)) {
    throw new HttpError(400, "Base URL 不在允许列表中");
  }

  return url.href.replace(/\/$/, "");
}

function isValidModelName(value: unknown): value is AiSettings["modelName"] {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9._:/-]+$/.test(value)
  );
}

function isValidOutline(value: unknown): value is CourseChapter[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (chapter) =>
        chapter &&
        typeof chapter.id === "string" &&
        typeof chapter.title === "string" &&
        Array.isArray(chapter.sections) &&
        chapter.sections.length > 0 &&
        chapter.sections.every(
          (section: unknown) =>
            section &&
            typeof section === "object" &&
            "id" in section &&
            typeof section.id === "string" &&
            "title" in section &&
            typeof section.title === "string" &&
            "status" in section &&
            ["done", "current", "locked"].includes(String(section.status)),
        ),
    )
  );
}

function isValidOutlineSummary(
  value: unknown,
): value is NonNullable<LearningProject["outlineSummary"]> {
  return (
    value !== null &&
    typeof value === "object" &&
    "audience" in value &&
    typeof value.audience === "string" &&
    "courseGoal" in value &&
    typeof value.courseGoal === "string" &&
    "estimatedHours" in value &&
    typeof value.estimatedHours === "number"
  );
}

function parseOutlinePreferences(value: unknown): OutlinePreferences {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object") {
    throw new HttpError(400, "课程设置格式无效");
  }
  const input = value as Record<string, unknown>;
  const preferences: OutlinePreferences = {};
  const keys: Array<keyof OutlinePreferences> = [
    "learningGoal",
    "currentLevel",
    "coveragePreference",
    "timeBudget",
    "sessionLength",
  ];
  for (const key of keys) {
    const item = input[key];
    if (item === undefined || item === "") continue;
    if (typeof item !== "string" || item.length > 240) {
      throw new HttpError(400, "课程设置单项不能超过 240 个字符");
    }
    preferences[key] = item.trim();
  }
  return preferences;
}

function isValidOutlinePlan(value: unknown): value is OutlinePlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<OutlinePlan>;
  return (
    typeof plan.courseType === "string" &&
    typeof plan.targetOutcome === "string" &&
    typeof plan.priorKnowledge === "string" &&
    (plan.depth === "intro" ||
      plan.depth === "standard" ||
      plan.depth === "deep") &&
    typeof plan.estimatedHours === "number" &&
    typeof plan.sessionMinutes === "number" &&
    Array.isArray(plan.assumptions) &&
    plan.assumptions.every((item) => typeof item === "string") &&
    Array.isArray(plan.researchQueries) &&
    plan.researchQueries.every((item) => typeof item === "string")
  );
}

function isValidOutlineAudit(value: unknown): value is OutlineAudit {
  if (!value || typeof value !== "object") return false;
  const audit = value as Partial<OutlineAudit>;
  return (
    (audit.status === "passed" || audit.status === "adjusted") &&
    typeof audit.coverage === "string" &&
    typeof audit.granularity === "string" &&
    typeof audit.sequence === "string" &&
    Array.isArray(audit.changes) &&
    audit.changes.every((item) => typeof item === "string")
  );
}

function isValidLessonContent(value: unknown): value is LessonContent {
  if (!value || typeof value !== "object") return false;
  const content = value as Partial<LessonContent>;
  return (
    typeof content.generatedAt === "string" &&
    typeof content.modelName === "string" &&
    typeof content.overview === "string" &&
    Boolean(content.mindMap) &&
    typeof content.mindMap?.center === "string" &&
    Array.isArray(content.mindMap.branches) &&
    content.mindMap.branches.length >= 3 &&
    content.mindMap.branches.every(
      (branch) =>
        typeof branch.title === "string" &&
        Array.isArray(branch.details) &&
        branch.details.every((detail) => typeof detail === "string"),
    ) &&
    Boolean(content.explanation) &&
    typeof content.explanation?.lead === "string" &&
    Array.isArray(content.explanation.paragraphs) &&
    Array.isArray(content.explanation.keyPoints) &&
    Boolean(content.example) &&
    typeof content.example?.title === "string" &&
    Array.isArray(content.example.steps) &&
    Boolean(content.exercise) &&
    typeof content.exercise?.question === "string" &&
    Array.isArray(content.exercise.options) &&
    content.exercise.options.length === 4 &&
    typeof content.exercise.answerIndex === "number" &&
    typeof content.exercise.explanation === "string"
  );
}

function isValidWebSource(value: unknown): value is WebSource {
  return (
    value !== null &&
    typeof value === "object" &&
    "title" in value &&
    typeof value.title === "string" &&
    "url" in value &&
    typeof value.url === "string" &&
    "snippet" in value &&
    typeof value.snippet === "string"
  );
}

function isValidOutlinePolishPatches(
  value: unknown,
): value is OutlinePolishPatch[] {
  return (
    Array.isArray(value) &&
    value.every(
      (patch) =>
        patch &&
        typeof patch === "object" &&
        "id" in patch &&
        typeof patch.id === "string" &&
        "type" in patch &&
        (patch.type === "chapter" || patch.type === "section") &&
        "title" in patch &&
        typeof patch.title === "string" &&
        (patch.type !== "chapter" ||
          ("objective" in patch && typeof patch.objective === "string")) &&
        (patch.type !== "section" ||
          ("outcome" in patch && typeof patch.outcome === "string")),
    )
  );
}

async function route(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, service: "圆趣学习 TS 后端" });
  }

  if (req.method === "GET" && pathname === "/api/agents") {
    return sendJson(res, 200, { agents: listAgents() });
  }

  if (req.method === "POST" && pathname === "/api/agents/run") {
    const body = await readJson<{
      agent: AgentName;
      input?: Record<string, unknown>;
      projectId?: string;
    }>(req);
    const store = await readStore();
    const result = await runAgent({
      agentName: body.agent,
      input: body.input ?? {},
      projectId: body.projectId,
      store,
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/projects/generate-description") {
    const body = await readJson<{ topic?: unknown }>(req);
    if (
      typeof body.topic !== "string" ||
      !body.topic.trim() ||
      body.topic.length > 200
    ) {
      throw new HttpError(400, "课题名称需要包含 1–200 个字符");
    }
    const store = await readStore();
    if (!store.aiSettings.apiKey) {
      throw new HttpError(400, "请先在设置中配置 DeepSeek API Key");
    }
    if (!store.aiSettings.modelName.trim()) {
      throw new HttpError(400, "请先从 DeepSeek 官方列表选择模型");
    }

    try {
      const result = await runAgent({
        agentName: "project-creator",
        input: {
          action: "generate-description",
          topic: body.topic.trim(),
        },
        store,
      });
      if (
        typeof result.data.description !== "string" ||
        !result.data.description.trim()
      ) {
        throw new Error("项目创建 Agent 未返回有效描述");
      }
      return sendJson(res, 200, {
        description: result.data.description,
        summary: result.summary,
      });
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "内容描述生成失败",
      );
    }
  }

  if (req.method === "POST" && pathname === "/api/projects/suggest-preferences") {
    const body = await readJson<{
      topic?: unknown;
      description?: unknown;
    }>(req);
    if (
      typeof body.topic !== "string" ||
      !body.topic.trim() ||
      body.topic.length > 200
    ) {
      throw new HttpError(400, "课题名称需要包含 1–200 个字符");
    }
    if (
      body.description !== undefined &&
      (typeof body.description !== "string" || body.description.length > 1_000)
    ) {
      throw new HttpError(400, "内容描述格式无效");
    }
    const store = await readStore();
    try {
      const result = await runAgent({
        agentName: "project-creator",
        input: {
          action: "suggest-preferences",
          topic: body.topic.trim(),
          description:
            typeof body.description === "string"
              ? body.description.trim()
              : "",
        },
        store,
      });
      const recommendations = result.data.recommendations;
      if (
        !recommendations ||
        typeof recommendations !== "object" ||
        Array.isArray(recommendations)
      ) {
        throw new Error("项目创建 Agent 未返回有效建议");
      }
      return sendJson(res, 200, {
        recommendations,
        summary: result.summary,
      });
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "学习方式建议生成失败",
      );
    }
  }

  if (req.method === "GET" && pathname === "/api/projects") {
    const store = await readStore();
    return sendJson(res, 200, { projects: store.projects });
  }

  if (req.method === "POST" && pathname === "/api/projects") {
    const body = await readJson<{ title?: unknown; description?: unknown }>(req);
    const title = body.title;
    const description = body.description;
    if (typeof title !== "string" || typeof description !== "string") {
      throw new HttpError(400, "项目标题和描述必须是字符串");
    }
    const project = await createProject({ title, description });
    return sendJson(res, 201, { project });
  }

  const projectId = getProjectId(pathname);
  if (req.method === "GET" && projectId) {
    const store = await readStore();
    const project = store.projects.find((item) => item.id === projectId);
    return project ? sendJson(res, 200, { project }) : sendJson(res, 404, { error: "项目不存在" });
  }

  const outlineProjectId = getProjectId(pathname, "outline");
  if (req.method === "PUT" && outlineProjectId) {
    const body = await readJson<{ chapters?: unknown }>(req);
    if (!isValidOutline(body.chapters)) {
      throw new HttpError(400, "大纲至少需要一个章节，且每章至少需要一个小节");
    }
    const store = await readStore();
    const project = store.projects.find((item) => item.id === outlineProjectId);
    if (!project) return sendJson(res, 404, { error: "项目不存在" });
    project.chapters = body.chapters;
    await writeStore(store);
    return sendJson(res, 200, { project });
  }

  const generateOutlineProjectId = getProjectId(pathname, "generate-outline");
  if (req.method === "POST" && generateOutlineProjectId) {
    const body = await readJson<{ mode?: unknown; preferences?: unknown }>(req);
    const mode = body.mode === "optimize" ? "optimize" : "generate";
    const preferences = parseOutlinePreferences(body.preferences);
    const store = await readStore();
    const project = store.projects.find((item) => item.id === generateOutlineProjectId);
    if (!project) return sendJson(res, 404, { error: "项目不存在" });
    const result = await runAgent({
      agentName: "outline",
      input: { mode, preferences },
      projectId: project.id,
      store,
    });
    if (mode === "optimize") {
      if (!isValidOutlinePolishPatches(result.data.patches)) {
        throw new HttpError(502, "AI 节点润色返回了无效补丁");
      }
      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      let appliedCount = 0;
      for (const patch of result.data.patches) {
        if (patch.type === "chapter") {
          const chapter = project.chapters.find((item) => item.id === patch.id);
          if (
            !chapter ||
            (chapter.origin !== "user" &&
              !(!chapter.origin && uuidPattern.test(chapter.id)))
          ) {
            continue;
          }
          chapter.title = patch.title;
          chapter.objective = patch.objective;
          chapter.origin = "user";
          appliedCount += 1;
          continue;
        }

        const section = project.chapters
          .flatMap((chapter) => chapter.sections)
          .find((item) => item.id === patch.id);
        if (
          !section ||
          (section.origin !== "user" &&
            !(!section.origin && uuidPattern.test(section.id)))
        ) {
          continue;
        }
        section.title = patch.title;
        section.outcome = patch.outcome;
        section.origin = "user";
        appliedCount += 1;
      }
      await writeStore(store);
      return sendJson(res, 200, {
        ...result,
        data: {
          ...result.data,
          polishedCount: appliedCount,
        },
        project,
      });
    }

    if (isValidOutline(result.data.chapters)) {
      project.chapters = result.data.chapters;
    }
    if (isValidOutlineSummary(result.data.outlineSummary)) {
      project.outlineSummary = result.data.outlineSummary;
    }
    project.outlinePreferences = preferences;
    if (isValidOutlinePlan(result.data.outlinePlan)) {
      project.outlinePlan = result.data.outlinePlan;
    } else {
      delete project.outlinePlan;
    }
    if (isValidOutlineAudit(result.data.outlineAudit)) {
      project.outlineAudit = result.data.outlineAudit;
    } else {
      delete project.outlineAudit;
    }
    project.sources = Array.isArray(result.data.sources)
      ? (result.data.sources as WebSource[])
      : [];
    project.generation = {
      webSearchUsed: result.data.webSearchUsed === true,
      generatedAt: new Date().toISOString(),
      query: typeof result.data.query === "string" ? result.data.query : project.title,
      outlineStatus:
        result.data.fallbackUsed === true
          ? "fallback"
          : isValidOutlineAudit(result.data.outlineAudit)
            ? "ready"
            : "draft",
      ...(typeof result.data.warning === "string"
        ? { warning: result.data.warning }
        : {}),
    };
    await writeStore(store);
    return sendJson(res, 200, { ...result, project });
  }

  const lessonRoute = getSectionRoute(pathname, "generate-content");
  if (req.method === "POST" && lessonRoute) {
    const body = await readJson<{ force?: unknown }>(req);
    const store = await readStore();
    const project = store.projects.find(
      (item) => item.id === lessonRoute.projectId,
    );
    if (!project) return sendJson(res, 404, { error: "项目不存在" });
    const chapter = project.chapters.find((item) =>
      item.sections.some((section) => section.id === lessonRoute.sectionId),
    );
    const section = chapter?.sections.find(
      (item) => item.id === lessonRoute.sectionId,
    );
    if (!chapter || !section) {
      return sendJson(res, 404, { error: "学习小节不存在" });
    }

    if (
      section.content &&
      section.content.research &&
      body.force !== true
    ) {
      return sendJson(res, 200, {
        project,
        content: section.content,
        cached: true,
        summary: "已加载保存的课程内容。",
      });
    }
    if (!store.aiSettings.apiKey) {
      throw new HttpError(400, "请先在设置中配置 DeepSeek API Key");
    }
    if (!store.aiSettings.modelName.trim()) {
      throw new HttpError(400, "请先从 DeepSeek 官方列表选择模型");
    }

    try {
      const result = await runAgent({
        agentName: "course-content",
        input: {
          chapterId: chapter.id,
          sectionId: section.id,
          refreshSources: body.force === true,
        },
        projectId: project.id,
        store,
      });
      const content = result.data.content;
      if (!isValidLessonContent(content)) {
        throw new Error("课程内容 Agent 返回了无效结构");
      }
      const incomingSources = Array.isArray(result.data.sources)
        ? result.data.sources.filter(isValidWebSource)
        : [];
      const sourcesByUrl = new Map(
        (project.sources ?? []).map((source) => [source.url, source]),
      );
      for (const source of incomingSources) {
        sourcesByUrl.set(source.url, source);
      }
      project.sources = Array.from(sourcesByUrl.values());
      const sourceRefs = Array.isArray(result.data.sourceRefs)
        ? result.data.sourceRefs.filter(
            (value): value is string =>
              typeof value === "string" && sourcesByUrl.has(value),
          )
        : [];
      section.sourceRefs = Array.from(new Set(sourceRefs));
      section.content = content;
      await writeStore(store);
      return sendJson(res, 200, {
        project,
        content,
        cached: false,
        summary: result.summary,
        webSearchUsed: result.data.webSearchUsed === true,
        sourceCount: section.sourceRefs.length,
        ...(typeof result.data.warning === "string"
          ? { warning: result.data.warning }
          : {}),
      });
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "课程内容生成失败",
      );
    }
  }

  const tutorRoute = getSectionRoute(pathname, "tutor");
  if (req.method === "POST" && tutorRoute) {
    const body = await readJson<{
      message?: unknown;
      history?: unknown;
      learningContext?: unknown;
    }>(req);
    if (
      typeof body.message !== "string" ||
      !body.message.trim() ||
      body.message.length > 2000
    ) {
      throw new HttpError(400, "请输入 1–2000 个字符的问题");
    }

    const store = await readStore();
    const project = store.projects.find(
      (item) => item.id === tutorRoute.projectId,
    );
    if (!project) return sendJson(res, 404, { error: "项目不存在" });
    const sectionExists = project.chapters.some((chapter) =>
      chapter.sections.some((section) => section.id === tutorRoute.sectionId),
    );
    if (!sectionExists) {
      return sendJson(res, 404, { error: "学习小节不存在" });
    }
    if (!store.aiSettings.apiKey) {
      throw new HttpError(400, "请先在设置中配置 DeepSeek API Key");
    }
    if (!store.aiSettings.modelName.trim()) {
      throw new HttpError(400, "请先从 DeepSeek 官方列表选择模型");
    }

    try {
      const result = await runAgent({
        agentName: "tutor",
        input: {
          sectionId: tutorRoute.sectionId,
          message: body.message,
          history: body.history,
          learningContext: body.learningContext,
        },
        projectId: project.id,
        store,
      });
      if (typeof result.data.answer !== "string" || !result.data.answer.trim()) {
        throw new Error("AI 助教未返回有效内容");
      }
      return sendJson(res, 200, {
        answer: result.data.answer,
        suggestions: Array.isArray(result.data.suggestions)
          ? result.data.suggestions
          : [],
        recommendedAction:
          typeof result.data.recommendedAction === "string"
            ? result.data.recommendedAction
            : undefined,
      });
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "AI 助教回答失败",
      );
    }
  }

  const completeRoute = getSectionRoute(pathname, "complete");
  if (req.method === "POST" && completeRoute) {
    const store = await readStore();
    const project = store.projects.find(
      (item) => item.id === completeRoute.projectId,
    );
    if (!project) return sendJson(res, 404, { error: "项目不存在" });

    const positions = project.chapters.flatMap((chapter) =>
      chapter.sections.map((section) => ({
        chapterId: chapter.id,
        section,
      })),
    );
    const currentIndex = positions.findIndex(
      (item) => item.section.id === completeRoute.sectionId,
    );
    if (currentIndex < 0) {
      return sendJson(res, 404, { error: "学习小节不存在" });
    }

    positions[currentIndex].section.status = "done";
    positions.forEach((item) => {
      if (item.section.status === "current") item.section.status = "locked";
    });
    const nextPosition =
      positions.slice(currentIndex + 1).find((item) => item.section.status !== "done") ??
      positions.find((item) => item.section.status !== "done");
    if (nextPosition) nextPosition.section.status = "current";

    const completedCount = positions.filter(
      (item) => item.section.status === "done",
    ).length;
    project.progress = positions.length
      ? Math.round((completedCount / positions.length) * 100)
      : 0;
    project.pendingTasks = positions.length - completedCount;
    project.lastStudied = "刚刚";
    await writeStore(store);

    return sendJson(res, 200, {
      project,
      next: nextPosition
        ? {
            chapterId: nextPosition.chapterId,
            sectionId: nextPosition.section.id,
          }
        : null,
    });
  }

  if (req.method === "GET" && pathname === "/api/settings/ai") {
    const store = await readStore();
    const { apiKey: _apiKey, ...safeSettings } = store.aiSettings;
    return sendJson(res, 200, {
      settings: {
        ...safeSettings,
        apiKeyConfigured: Boolean(store.aiSettings.apiKey),
        apiKeyPersisted: isApiKeyPersisted(),
        keyProtection: getSecretProtectionStatus(),
      },
    });
  }

  if (req.method === "GET" && pathname === "/api/models") {
    const store = await readStore();
    if (!store.aiSettings.apiKey) {
      throw new HttpError(400, "请先配置 DeepSeek API Key");
    }
    try {
      const models = await listDeepSeekModels(store.aiSettings);
      return sendJson(res, 200, { models });
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "获取官方模型列表失败",
      );
    }
  }

  if (req.method === "PUT" && pathname === "/api/settings/ai") {
    const body = await readJson<{
      modelName?: unknown;
      baseUrl?: unknown;
      apiKey?: unknown;
    }>(req);
    const store = await readStore();

    if (body.modelName !== undefined) {
      if (!isValidModelName(body.modelName)) {
        throw new HttpError(400, "不支持该模型");
      }
      store.aiSettings.modelName = body.modelName;
    }

    if (body.baseUrl !== undefined) {
      store.aiSettings.baseUrl = normaliseAiBaseUrl(body.baseUrl);
    }

    if (body.apiKey !== undefined) {
      if (typeof body.apiKey !== "string" || body.apiKey.length > 512) {
        throw new HttpError(400, "API Key 格式无效");
      }
      if (body.apiKey.trim() && !canPersistSecrets()) {
        throw new HttpError(
          400,
          "当前系统未配置 APP_ENCRYPTION_KEY；请先配置 32 字节部署密钥，或通过 DEEPSEEK_API_KEY 环境变量提供密钥",
        );
      }
      setRuntimeApiKey(body.apiKey);
      store.aiSettings.apiKey = body.apiKey.trim() || undefined;
    }

    store.aiSettings.provider = "DeepSeek";
    await writeStore(store);
    const { apiKey: _apiKey, ...safeSettings } = store.aiSettings;
    return sendJson(res, 200, {
      settings: {
        ...safeSettings,
        apiKeyConfigured: Boolean(store.aiSettings.apiKey),
        apiKeyPersisted: isApiKeyPersisted(),
        keyProtection: getSecretProtectionStatus(),
      },
    });
  }

  if (req.method === "GET" && pathname === "/api/settings/search") {
    const store = await readStore();
    return sendJson(res, 200, {
      settings: {
        provider: store.webSearchSettings.provider,
        apiKeyConfigured: Boolean(store.webSearchSettings.apiKey),
        apiKeyPersisted: isWebSearchApiKeyPersisted(),
        keyProtection: getSecretProtectionStatus(),
      },
    });
  }

  if (req.method === "PUT" && pathname === "/api/settings/search") {
    const body = await readJson<{ apiKey?: unknown }>(req);
    const store = await readStore();

    if (body.apiKey !== undefined) {
      if (typeof body.apiKey !== "string" || body.apiKey.length > 512) {
        throw new HttpError(400, "Web Search API Key 格式无效");
      }
      if (body.apiKey.trim() && !canPersistSecrets()) {
        throw new HttpError(
          400,
          "当前系统未配置 APP_ENCRYPTION_KEY；请先配置 32 字节部署密钥，或通过 TAVILY_API_KEY 环境变量提供密钥",
        );
      }
      setRuntimeWebSearchApiKey(body.apiKey);
      store.webSearchSettings.apiKey = body.apiKey.trim() || undefined;
    }

    store.webSearchSettings.provider = "Tavily";
    await writeStore(store);
    return sendJson(res, 200, {
      settings: {
        provider: store.webSearchSettings.provider,
        apiKeyConfigured: Boolean(store.webSearchSettings.apiKey),
        apiKeyPersisted: isWebSearchApiKeyPersisted(),
        keyProtection: getSecretProtectionStatus(),
      },
    });
  }

  if (req.method === "POST" && pathname === "/api/search/test") {
    const store = await readStore();
    const result = await searchWeb(store.webSearchSettings, "Web Search API connection test");
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/ai/chat") {
    const body = await readJson<{ message: string; context?: string }>(req);
    const store = await readStore();
    const result = await callDeepSeek(store.aiSettings, [
      { role: "system", content: "你是圆趣学习 Web App 的 AI 助教，请用简体中文回答。" },
      { role: "user", content: `${body.context ? `上下文：${body.context}\n` : ""}${body.message}` },
    ]);
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: "接口不存在" });
}

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    if (!allowedOrigins.has(origin)) {
      return sendJson(res, 403, { error: "不允许的请求来源" });
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  route(req, res).catch((error: unknown) => {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(res, status, { error: error instanceof Error ? error.message : "服务器错误" });
  });
});

server.listen(port, host, () => {
  console.log(`TS backend listening on http://${host}:${port}`);
});
