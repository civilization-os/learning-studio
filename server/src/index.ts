import { db } from "./db/index.js";
import { users, verificationCodes } from "./db/schema.js";
import { hashPassword, comparePassword, generateToken, verifyToken } from "./auth.js";
import crypto from "node:crypto";
import { eq, or } from "drizzle-orm";
import { sendRegistrationCode } from "./verification.js";
import { migrateLegacyStoreIfPresent } from "./legacy-migration.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { listAgents, runAgent } from "./agents/index.js";
import { createChapterToolLibraryFingerprint } from "./agents/chapterToolLibraryAgent.js";
import { callDeepSeek, listDeepSeekModels } from "./deepseek.js";
import {
  createProject,
  deleteProject,
  isApiKeyPersisted,
  isWebSearchApiKeyPersisted,
  readStore,
  writeStore,
} from "./store.js";
import {
  AgentName,
  AiSettings,
  ChapterToolLibrary,
  CourseStrategy,
  CourseChapter,
  LessonContent,
  LessonProgress,
  LearningProject,
  OutlineAudit,
  OutlinePlan,
  OutlinePolishPatch,
  OutlinePreferences,
  SectionStrategy,
  WebSource,
} from "./types.js";
import { searchWeb } from "./webSearch.js";
import {
  canPersistSecrets,
  getSecretProtectionStatus,
} from "./secret-protection.js";
import {
  completeGenerationTask,
  createGenerationTask,
  failGenerationTask,
  getGenerationTask,
  listGenerationTasks,
  subscribeGenerationTasks,
  updateGenerationTask,
  type GenerationProgress,
  type GenerationTaskType,
} from "./generationTasks.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const maxBodyBytes = 1_000_000;
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3001,http://localhost:3001")
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
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Generation-Task-Id",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function getAuthenticatedUserId(req: IncomingMessage) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return undefined;
  return verifyToken(authHeader.substring(7))?.userId;
}

function getRequestTaskId(req: IncomingMessage, userId: string) {
  const value = req.headers["x-generation-task-id"];
  const task = typeof value === "string" ? getGenerationTask(value) : undefined;
  return typeof value === "string" && task?.userId === userId
    ? value
    : undefined;
}

function getRequestProgressReporter(
  req: IncomingMessage,
  userId: string,
): ((progress: GenerationProgress) => void) | undefined {
  const taskId = getRequestTaskId(req, userId);
  if (!taskId) return undefined;
  return (progress) => {
    updateGenerationTask(taskId, {
      status: "running",
      ...progress,
    });
  };
}

function sendGenerationTaskEvents(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(
    `event: snapshot\ndata: ${JSON.stringify({ tasks: listGenerationTasks(userId) })}\n\n`,
  );
  const unsubscribe = subscribeGenerationTasks(userId, (task) => {
    res.write(`event: task\ndata: ${JSON.stringify(task)}\n\n`);
  });
  const keepAlive = setInterval(() => {
    res.write(`: keep-alive ${Date.now()}\n\n`);
  }, 15_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
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

const validStrategyModes = new Set([
  "exam",
  "work",
  "academic",
  "quick-start",
  "mastery",
]);
const validDifficultyDimensions = new Set([
  "recognition",
  "concept",
  "procedure",
  "calculation",
  "transfer",
  "diagnosis",
  "tradeoff",
]);
const validResearchPurposes = new Set([
  "scope",
  "tasks",
  "dependencies",
  "methods",
  "pitfalls",
  "evidence",
]);
const validKnowledgeRoles = new Set([
  "foundation",
  "tool",
  "bridge",
  "application",
  "verification",
]);

function isValidCourseStrategy(value: unknown): value is CourseStrategy {
  if (!value || typeof value !== "object") return false;
  const strategy = value as Partial<CourseStrategy>;
  return (
    strategy.schemaVersion === 1 &&
    validStrategyModes.has(String(strategy.mode)) &&
    typeof strategy.rationale === "string" &&
    Array.isArray(strategy.targetEvidence) &&
    strategy.targetEvidence.length > 0 &&
    strategy.targetEvidence.every((item) => typeof item === "string") &&
    Array.isArray(strategy.difficultyPriorities) &&
    strategy.difficultyPriorities.length > 0 &&
    strategy.difficultyPriorities.every((item) =>
      validDifficultyDimensions.has(String(item)),
    ) &&
    Array.isArray(strategy.researchIntents) &&
    strategy.researchIntents.length > 0 &&
    strategy.researchIntents.every(
      (intent) =>
        intent &&
        validResearchPurposes.has(String(intent.purpose)) &&
        typeof intent.query === "string",
    )
  );
}

function isValidSectionStrategy(value: unknown): value is SectionStrategy {
  if (!value || typeof value !== "object") return false;
  const strategy = value as Partial<SectionStrategy>;
  return (
    validKnowledgeRoles.has(String(strategy.role)) &&
    typeof strategy.whyNow === "string" &&
    Array.isArray(strategy.futureUses) &&
    strategy.futureUses.length > 0 &&
    strategy.futureUses.every((item) => typeof item === "string") &&
    Array.isArray(strategy.successEvidence) &&
    strategy.successEvidence.length > 0 &&
    strategy.successEvidence.every((item) => typeof item === "string") &&
    Boolean(strategy.difficulty) &&
    validDifficultyDimensions.has(String(strategy.difficulty?.primary)) &&
    Array.isArray(strategy.difficulty?.factors) &&
    strategy.difficulty.factors.length > 0 &&
    strategy.difficulty.factors.every(
      (factor) =>
        factor &&
        validDifficultyDimensions.has(String(factor.dimension)) &&
        Number.isInteger(factor.level) &&
        factor.level >= 1 &&
        factor.level <= 5 &&
        typeof factor.reason === "string",
    )
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
            ["done", "current", "locked"].includes(String(section.status)) &&
            (!("strategy" in section) ||
              section.strategy === undefined ||
              isValidSectionStrategy(section.strategy)),
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
    plan.researchQueries.every((item) => typeof item === "string") &&
    (plan.strategy === undefined || isValidCourseStrategy(plan.strategy))
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
  const learningDesign = content.learningDesign;
  const toolbook = content.toolbook;
  const toolbookValid =
    toolbook === undefined ||
    (typeof toolbook.title === "string" &&
      typeof toolbook.scope === "string" &&
      typeof toolbook.completenessNote === "string" &&
      Array.isArray(toolbook.items) &&
      toolbook.items.length >= 1 &&
      toolbook.items.length <= 18 &&
      toolbook.items.every(
        (item) =>
          typeof item.title === "string" &&
          [
            "formula",
            "rule",
            "checklist",
            "command",
            "template",
            "reference",
          ].includes(item.category) &&
          ["remember", "lookup"].includes(item.tier) &&
          Array.isArray(item.content) &&
          item.content.every((entry) => typeof entry === "string") &&
          (item.useWhen === undefined || typeof item.useWhen === "string") &&
          (item.boundary === undefined || typeof item.boundary === "string"),
      ));
  const learningDesignValid =
    learningDesign === undefined ||
    (validStrategyModes.has(String(learningDesign.strategyMode)) &&
      typeof learningDesign.whyNow === "string" &&
      Array.isArray(learningDesign.futureUses) &&
      learningDesign.futureUses.every((item) => typeof item === "string") &&
      Array.isArray(learningDesign.successCriteria) &&
      learningDesign.successCriteria.every(
        (item) => typeof item === "string",
      ) &&
      Array.isArray(learningDesign.difficultyFocus) &&
      learningDesign.difficultyFocus.every(
        (item) => typeof item === "string",
      ) &&
      Array.isArray(learningDesign.methodPaths) &&
      learningDesign.methodPaths.every(
        (path) =>
          typeof path.name === "string" &&
          typeof path.principle === "string" &&
          typeof path.bestFor === "string" &&
          typeof path.boundary === "string",
      ));
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
    (content.interactiveDemos === undefined ||
      (Array.isArray(content.interactiveDemos) &&
        content.interactiveDemos.every(
          (demo) =>
            demo !== null &&
            typeof demo === "object" &&
            ["slider", "step-animation", "compare"].includes(
              String((demo as { type?: unknown }).type),
            ) &&
            typeof (demo as { title?: unknown }).title === "string",
        ))) &&
    (Boolean(content.exercise) &&
      typeof content.exercise?.question === "string" &&
      Array.isArray(content.exercise.options) &&
      content.exercise.options.length === 4 &&
      typeof content.exercise.answerIndex === "number" &&
      typeof content.exercise.explanation === "string" ||
      Array.isArray(content.exercises) &&
        content.exercises.length >= 1 &&
        content.exercises.every(
          (item) =>
            item !== null &&
            typeof item === "object" &&
            ["single-choice", "true-false", "fill-blank", "calculation", "explanation"].includes(
              String((item as { type?: unknown }).type),
            ) &&
            typeof (item as { question?: unknown }).question === "string",
        )) &&
    learningDesignValid &&
    toolbookValid
  );
}

function getChapterRoute(pathname: string, action: string) {
  const match = pathname.match(
    new RegExp(`^/api/projects/([^/]+)/chapters/([^/]+)/${action}$`),
  );
  return match
    ? {
        projectId: decodeURIComponent(match[1]),
        chapterId: decodeURIComponent(match[2]),
      }
    : null;
}

const validChapterToolCategories = new Set([
  "concept",
  "formula",
  "method",
  "decision",
  "procedure",
  "checklist",
  "pattern",
  "reference",
]);
const validChapterToolPlacements = new Set([
  "chapter-core",
  "chapter-support",
  "later-bridge",
]);
const validChapterToolBases = new Set([
  "course-scope",
  "reference-structure",
  "section-outcome",
  "downstream-dependency",
]);

function isValidChapterToolLibrary(
  value: unknown,
): value is ChapterToolLibrary {
  if (!value || typeof value !== "object") return false;
  const library = value as Partial<ChapterToolLibrary>;
  return (
    library.schemaVersion === 1 &&
    typeof library.chapterId === "string" &&
    typeof library.title === "string" &&
    typeof library.scope === "string" &&
    typeof library.generatedAt === "string" &&
    typeof library.modelName === "string" &&
    typeof library.outlineFingerprint === "string" &&
    Array.isArray(library.sourceRefs) &&
    library.sourceRefs.every((item) => typeof item === "string") &&
    Array.isArray(library.items) &&
    library.items.length >= 4 &&
    library.items.length <= 120 &&
    library.items.every(
      (item) =>
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        validChapterToolCategories.has(item.category) &&
        validChapterToolPlacements.has(item.placement) &&
        typeof item.summary === "string" &&
        Array.isArray(item.content) &&
        item.content.length > 0 &&
        item.content.every((entry) => typeof entry === "string") &&
        typeof item.useWhen === "string" &&
        typeof item.boundary === "string" &&
        (item.introducedInSectionId === undefined ||
          typeof item.introducedInSectionId === "string") &&
        Array.isArray(item.relatedSectionIds) &&
        item.relatedSectionIds.every((entry) => typeof entry === "string") &&
        Array.isArray(item.usedInSectionIds) &&
        item.usedInSectionIds.every((entry) => typeof entry === "string") &&
        Array.isArray(item.sourceRefs) &&
        item.sourceRefs.every((entry) => typeof entry === "string") &&
        Array.isArray(item.basis) &&
        item.basis.length > 0 &&
        item.basis.every((entry) => validChapterToolBases.has(entry)),
    ) &&
    Boolean(library.generation) &&
    typeof library.generation?.webSearchUsed === "boolean" &&
    Array.isArray(library.generation.researchQueries) &&
    library.generation.researchQueries.every(
      (entry) => typeof entry === "string",
    ) &&
    Array.isArray(library.generation.coverageAreas) &&
    library.generation.coverageAreas.every(
      (entry) => typeof entry === "string",
    ) &&
    Array.isArray(library.generation.passes) &&
    ["scope", "research", "inventory", "dependencies", "review"].every(
      (pass) =>
        library.generation?.passes.includes(
          pass as ChapterToolLibrary["generation"]["passes"][number],
        ),
    )
  );
}

function isValidLessonProgress(value: unknown): value is LessonProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as Partial<LessonProgress>;
  if (
    progress.schemaVersion !== 1 ||
    typeof progress.updatedAt !== "string" ||
    (progress.currentSceneId !== undefined &&
      typeof progress.currentSceneId !== "string") ||
    !Array.isArray(progress.completedSceneIds) ||
    progress.completedSceneIds.length > 100 ||
    !progress.completedSceneIds.every(
      (sceneId) => typeof sceneId === "string" && sceneId.length <= 160,
    ) ||
    !progress.evidence ||
    typeof progress.evidence !== "object"
  ) {
    return false;
  }

  const evidenceItems = Object.values(progress.evidence);
  const evidenceValid =
    evidenceItems.length <= 100 &&
    evidenceItems.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.sceneId === "string" &&
        item.sceneId.length <= 160 &&
        Number.isInteger(item.attempts) &&
        item.attempts >= 0 &&
        item.attempts <= 100 &&
        Number.isInteger(item.hintsUsed) &&
        item.hintsUsed >= 0 &&
        item.hintsUsed <= 20 &&
        typeof item.completed === "boolean" &&
        typeof item.updatedAt === "string" &&
        (item.selectedIndex === undefined ||
          (Number.isInteger(item.selectedIndex) &&
            item.selectedIndex >= 0 &&
            item.selectedIndex <= 20)) &&
        (item.correct === undefined || typeof item.correct === "boolean") &&
        (item.firstTryCorrect === undefined ||
          typeof item.firstTryCorrect === "boolean") &&
        (item.outcome === undefined ||
          ["mastered", "supported", "needs-review", "skipped"].includes(
            item.outcome,
          )) &&
        (item.route === undefined ||
          ["standard", "support", "fast-track", "challenge"].includes(
            item.route,
          )),
    );
  if (!evidenceValid) return false;

  if (progress.knowledge !== undefined) {
    if (
      !progress.knowledge ||
      typeof progress.knowledge !== "object" ||
      Array.isArray(progress.knowledge)
    ) {
      return false;
    }
    const knowledgeItems = Object.values(progress.knowledge);
    const knowledgeValid =
      knowledgeItems.length <= 100 &&
      knowledgeItems.every(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          typeof item.conceptKey === "string" &&
          item.conceptKey.length <= 120 &&
          typeof item.label === "string" &&
          item.label.length <= 160 &&
          typeof item.mastery === "number" &&
          item.mastery >= 0 &&
          item.mastery <= 1 &&
          Number.isInteger(item.evidenceCount) &&
          item.evidenceCount >= 0 &&
          item.evidenceCount <= 1000 &&
          Number.isInteger(item.correctCount) &&
          item.correctCount >= 0 &&
          item.correctCount <= 1000 &&
          Number.isInteger(item.attempts) &&
          item.attempts >= 0 &&
          item.attempts <= 1000 &&
          Number.isInteger(item.hintsUsed) &&
          item.hintsUsed >= 0 &&
          item.hintsUsed <= 1000 &&
          ["mastered", "supported", "needs-review"].includes(
            item.lastOutcome,
          ) &&
          typeof item.lastSeenAt === "string" &&
          typeof item.nextReviewAt === "string" &&
          (item.intervalDays === undefined ||
            (typeof item.intervalDays === "number" &&
              Number.isInteger(item.intervalDays) &&
              item.intervalDays >= 0 &&
              item.intervalDays <= 90)) &&
          (item.reviewCount === undefined ||
            (typeof item.reviewCount === "number" &&
              Number.isInteger(item.reviewCount) &&
              item.reviewCount >= 0 &&
              item.reviewCount <= 1000)) &&
          (item.misconception === undefined ||
            (typeof item.misconception === "string" &&
              item.misconception.length <= 500)),
      );
    if (!knowledgeValid) return false;
  }

  if (progress.reflection === undefined) return true;
  const reflection = progress.reflection;
  return (
    typeof reflection.summary === "string" &&
    reflection.summary.length <= 1200 &&
    ["uncertain", "partial", "ready"].includes(reflection.confidence) &&
    typeof reflection.updatedAt === "string" &&
    (reflection.tutorFeedback === undefined ||
      (typeof reflection.tutorFeedback === "string" &&
        reflection.tutorFeedback.length <= 4000))
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
  let userId = "";

  if (req.method === "POST" && pathname === "/api/auth/send-code") {
    const body = await readJson<{ email?: unknown }>(req);
    if (typeof body.email !== "string") {
      throw new HttpError(400, "请输入有效的邮箱地址");
    }
    try {
      const delivery = await sendRegistrationCode(body.email);
      return sendJson(res, 200, {
        message: "验证码已发送，请在 10 分钟内完成注册",
        ...(delivery.devCode ? { devCode: delivery.devCode } : {}),
      });
    } catch (error) {
      throw new HttpError(
        error instanceof Error && error.message.includes("邮件服务") ? 503 : 400,
        error instanceof Error ? error.message : "验证码发送失败",
      );
    }
  }

  if (req.method === "POST" && pathname === "/api/auth/register") {
    const body = await readJson<{
      username?: unknown;
      password?: unknown;
      email?: unknown;
      code?: unknown;
      avatar?: unknown;
      nickname?: unknown;
    }>(req);
    if (
      typeof body.username !== "string" ||
      typeof body.password !== "string" ||
      typeof body.email !== "string" ||
      typeof body.code !== "string"
    ) {
      throw new HttpError(400, "注册信息不完整");
    }

    const username = body.username.trim();
    const email = body.email.trim().toLowerCase();
    const password = body.password;
    const code = body.code.trim();
    const avatar =
      typeof body.avatar === "string" ? body.avatar.trim().slice(0, 32) : "🐶";
    const nickname =
      typeof body.nickname === "string" && body.nickname.trim()
        ? body.nickname.trim().slice(0, 40)
        : username;

    if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(username)) {
      throw new HttpError(400, "用户名需为 3–32 位字母、数字、下划线或短横线");
    }
    if (password.length < 8 || password.length > 128) {
      throw new HttpError(400, "密码长度需为 8–128 位");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, "请输入有效的邮箱地址");
    }

    const record = db
      .select()
      .from(verificationCodes)
      .where(eq(verificationCodes.email, email))
      .get();
    if (!record || record.code !== code || Date.now() > record.expiresAt.getTime()) {
      throw new HttpError(400, "验证码错误或已过期");
    }
    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, email)))
      .get();
    if (existing) {
      throw new HttpError(409, "用户名或邮箱已被注册");
    }

    const newUserId = `u_${crypto.randomBytes(8).toString("hex")}`;
    const passwordHash = await hashPassword(password);
    db.transaction((tx) => {
      tx.insert(users)
        .values({
          id: newUserId,
          username,
          passwordHash,
          email,
          avatar,
          nickname,
          createdAt: new Date(),
        })
        .run();
      tx.delete(verificationCodes)
        .where(eq(verificationCodes.email, email))
        .run();
    });

    // 旧版(单用户)store.json 数据迁移:归第一个注册的账号
    try {
      await migrateLegacyStoreIfPresent(newUserId);
    } catch (error) {
      console.warn(
        "[migration] 旧数据迁移失败:",
        error instanceof Error ? error.message : error,
      );
    }

    const token = generateToken(newUserId);
    return sendJson(res, 201, {
      token,
      userId: newUserId,
      username,
      nickname,
      avatar,
    });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson<{ username?: unknown; password?: unknown }>(req);
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      throw new HttpError(400, "用户名或密码无效");
    }
    const username = body.username.trim();
    const user = db.select().from(users).where(eq(users.username, username)).get();
    if (!user || !(await comparePassword(body.password, user.passwordHash))) {
      throw new HttpError(401, "用户名或密码错误");
    }
    const token = generateToken(user.id);
    return sendJson(res, 200, {
      token,
      userId: user.id,
      username: user.username,
      nickname: user.nickname || user.username,
      avatar: user.avatar,
    });
  }

  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth/") &&
    pathname !== "/api/health"
  ) {
    const authenticatedUserId = getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      return sendJson(res, 401, { error: "Token 无效或已过期" });
    }
    const userExists = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, authenticatedUserId))
      .get();
    if (!userExists) {
      return sendJson(res, 401, { error: "账号不存在或已停用" });
    }
    userId = authenticatedUserId;
  }

    if (req.method === "GET" && pathname === "/api/user/profile") {
        const user = db.select().from(users).where(eq(users.id, userId)).get();
        if (!user) return sendJson(res, 404, { error: "用户不存在" });
        return sendJson(res, 200, {
            userId: user.id,
            username: user.username,
            nickname: user.nickname || user.username,
            avatar: user.avatar,
            email: user.email,
        });
    }

  if (req.method === "PUT" && pathname === "/api/user/profile") {
    const body = await readJson<{ nickname?: unknown; avatar?: unknown }>(req);
    const nickname =
      typeof body.nickname === "string" ? body.nickname.trim() : undefined;
    const avatar =
      typeof body.avatar === "string" ? body.avatar.trim() : undefined;
    if (nickname !== undefined && nickname.length > 40) {
      throw new HttpError(400, "昵称不能超过 40 个字符");
    }
    if (avatar !== undefined && avatar.length > 32) {
      throw new HttpError(400, "头像内容过长");
    }
    const updateData: Record<string, string> = {};
    if (nickname !== undefined) updateData.nickname = nickname;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (Object.keys(updateData).length > 0) {
      db.update(users).set(updateData).where(eq(users.id, userId)).run();
    }
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    return sendJson(res, 200, {
      userId: user?.id,
      username: user?.username,
      nickname: user?.nickname || user?.username,
      avatar: user?.avatar,
    });
  }


  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, service: "圆趣学习 TS 后端" });
  }

  if (req.method === "GET" && pathname === "/api/generation-tasks/events") {
    return sendGenerationTaskEvents(req, res, userId);
  }

  if (req.method === "GET" && pathname === "/api/generation-tasks") {
    return sendJson(res, 200, { tasks: listGenerationTasks(userId) });
  }

  if (req.method === "POST" && pathname === "/api/generation-tasks") {
    const body = await readJson<{
      type?: unknown;
      title?: unknown;
      projectId?: unknown;
      chapterId?: unknown;
      sectionId?: unknown;
    }>(req);
    const validTypes = new Set<GenerationTaskType>([
      "project-description",
      "preference-suggestions",
      "course-outline",
      "outline-polish",
      "lesson-content",
      "chapter-tool-library",
      "tutor-reply",
      "exercise",
      "agent-run",
      "connection-test",
    ]);
    if (
      typeof body.type !== "string" ||
      !validTypes.has(body.type as GenerationTaskType) ||
      typeof body.title !== "string" ||
      !body.title.trim()
    ) {
      throw new HttpError(400, "生成任务信息不完整");
    }
    const task = createGenerationTask({
      userId,
      type: body.type as GenerationTaskType,
      title: body.title,
      ...(typeof body.projectId === "string"
        ? { projectId: body.projectId }
        : {}),
      ...(typeof body.chapterId === "string"
        ? { chapterId: body.chapterId }
        : {}),
      ...(typeof body.sectionId === "string"
        ? { sectionId: body.sectionId }
        : {}),
    });
    return sendJson(res, 201, { task });
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
    const store = await readStore(userId);
    const taskId = getRequestTaskId(req, userId);
    const result = await runAgent({
      agentName: body.agent,
      input: body.input ?? {},
      projectId: body.projectId,
      store,
      reportProgress: getRequestProgressReporter(req, userId),
    });
    completeGenerationTask(taskId);
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
    const store = await readStore(userId);
    const taskId = getRequestTaskId(req, userId);
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
        reportProgress: getRequestProgressReporter(req, userId),
      });
      if (
        typeof result.data.description !== "string" ||
        !result.data.description.trim()
      ) {
        throw new Error("项目创建 Agent 未返回有效描述");
      }
      completeGenerationTask(taskId, "内容描述已经生成，可以继续修改");
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
    const store = await readStore(userId);
    const taskId = getRequestTaskId(req, userId);
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
        reportProgress: getRequestProgressReporter(req, userId),
      });
      const recommendations = result.data.recommendations;
      if (
        !recommendations ||
        typeof recommendations !== "object" ||
        Array.isArray(recommendations)
      ) {
        throw new Error("项目创建 Agent 未返回有效建议");
      }
      completeGenerationTask(taskId, "学习方式建议已经准备好");
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
    const store = await readStore(userId);
    return sendJson(res, 200, { projects: store.projects });
  }

  if (req.method === "POST" && pathname === "/api/projects") {
    const body = await readJson<{ title?: unknown; description?: unknown }>(req);
    const title = body.title;
    const description = body.description;
    if (typeof title !== "string" || typeof description !== "string") {
      throw new HttpError(400, "项目标题和描述必须是字符串");
    }
    const project = await createProject(userId, { title, description });
    return sendJson(res, 201, { project });
  }

  const projectId = getProjectId(pathname);
  if (req.method === "DELETE" && projectId) {
    const deleted = await deleteProject(userId, projectId);
    return sendJson(res, 200, { projectId, deleted });
  }

  if (req.method === "GET" && projectId) {
    const store = await readStore(userId);
    const project = store.projects.find((item) => item.id === projectId);
    return project ? sendJson(res, 200, { project }) : sendJson(res, 404, { error: "项目不存在" });
  }

  const outlineProjectId = getProjectId(pathname, "outline");
  if (req.method === "PUT" && outlineProjectId) {
    const body = await readJson<{ chapters?: unknown }>(req);
    if (!isValidOutline(body.chapters)) {
      throw new HttpError(400, "大纲至少需要一个章节，且每章至少需要一个小节");
    }
    const store = await readStore(userId);
    const project = store.projects.find((item) => item.id === outlineProjectId);
    if (!project) return sendJson(res, 404, { error: "项目不存在" });
    project.chapters = body.chapters;
    await writeStore(userId, store);
    return sendJson(res, 200, { project });
  }

  const generateOutlineProjectId = getProjectId(pathname, "generate-outline");
  if (req.method === "POST" && generateOutlineProjectId) {
    const body = await readJson<{ mode?: unknown; preferences?: unknown }>(req);
    const mode = body.mode === "optimize" ? "optimize" : "generate";
    const preferences = parseOutlinePreferences(body.preferences);
    const store = await readStore(userId);
    const taskId = getRequestTaskId(req, userId);
    const project = store.projects.find((item) => item.id === generateOutlineProjectId);
    if (!project) return sendJson(res, 404, { error: "项目不存在" });
    const result = await runAgent({
      agentName: "outline",
      input: { mode, preferences },
      projectId: project.id,
      store,
      reportProgress: getRequestProgressReporter(req, userId),
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
      await writeStore(userId, store);
      completeGenerationTask(taskId, "新增节点已经整理完成");
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
    await writeStore(userId, store);
    if (result.data.fallbackUsed === true) {
      failGenerationTask(
        taskId,
        typeof result.data.warning === "string"
          ? result.data.warning
          : "课程结构没有生成完成",
      );
    } else {
      completeGenerationTask(taskId, "新版课程结构已经准备好");
    }
    return sendJson(res, 200, { ...result, project });
  }

  const chapterToolRoute = getChapterRoute(
    pathname,
    "generate-tool-library",
  );
  if (req.method === "POST" && chapterToolRoute) {
    const body = await readJson<{ force?: unknown }>(req);
    const store = await readStore(userId);
    const taskId = getRequestTaskId(req, userId);
    const project = store.projects.find(
      (item) => item.id === chapterToolRoute.projectId,
    );
    if (!project) return sendJson(res, 404, { error: "项目不存在" });
    const chapter = project.chapters.find(
      (item) => item.id === chapterToolRoute.chapterId,
    );
    if (!chapter) return sendJson(res, 404, { error: "课程章节不存在" });

    const currentFingerprint = createChapterToolLibraryFingerprint(
      project,
      chapter.id,
    );
    if (
      body.force !== true &&
      chapter.toolLibrary &&
      chapter.toolLibrary.outlineFingerprint === currentFingerprint &&
      isValidChapterToolLibrary(chapter.toolLibrary)
    ) {
      completeGenerationTask(taskId, "已经加载保存的本章工具");
      return sendJson(res, 200, {
        project,
        toolLibrary: chapter.toolLibrary,
        cached: true,
        summary: "已加载保存的本章工具。",
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
        agentName: "chapter-tool-library",
        input: { chapterId: chapter.id },
        projectId: project.id,
        store,
        reportProgress: getRequestProgressReporter(req, userId),
      });
      if (!isValidChapterToolLibrary(result.data.toolLibrary)) {
        throw new Error("本章工具整理结果结构不完整");
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
      chapter.toolLibrary = result.data.toolLibrary;
      await writeStore(userId, store);
      completeGenerationTask(taskId, "本章工具已经整理完成");
      return sendJson(res, 200, {
        project,
        toolLibrary: chapter.toolLibrary,
        cached: false,
        summary: result.summary,
        ...(typeof result.data.warning === "string"
          ? { warning: result.data.warning }
          : {}),
      });
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "本章工具整理失败",
      );
    }
  }

  const lessonRoute = getSectionRoute(pathname, "generate-content");
  if (req.method === "POST" && lessonRoute) {
    const body = await readJson<{ force?: unknown }>(req);
    const store = await readStore(userId);
    const taskId = getRequestTaskId(req, userId);
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
      completeGenerationTask(taskId, "已经加载保存的课堂内容");
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
        reportProgress: getRequestProgressReporter(req, userId),
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
      await writeStore(userId, store);
      completeGenerationTask(taskId, "课堂内容已经准备好");
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
  const progressRoute = getSectionRoute(pathname, "progress");
  if (req.method === "PUT" && progressRoute) {
    const body = await readJson<{ progress?: unknown }>(req);
    if (!isValidLessonProgress(body.progress)) {
      throw new HttpError(400, "学习记录格式不正确");
    }

    const store = await readStore(userId);
    const project = store.projects.find(
      (item) => item.id === progressRoute.projectId,
    );
    if (!project) return sendJson(res, 404, { error: "项目不存在" });
    const section = project.chapters
      .flatMap((chapter) => chapter.sections)
      .find((item) => item.id === progressRoute.sectionId);
    if (!section) {
      return sendJson(res, 404, { error: "学习小节不存在" });
    }

    const progress: LessonProgress = {
      ...body.progress,
      completedSceneIds: Array.from(new Set(body.progress.completedSceneIds)),
      updatedAt: new Date().toISOString(),
    };
    section.learningProgress = progress;
    const allProgress = project.chapters
      .flatMap((chapter) => chapter.sections)
      .map((item) => item.learningProgress)
      .filter((item): item is LessonProgress => Boolean(item));
    const answeredEvidence = allProgress
      .flatMap((item) => Object.values(item.evidence))
      .filter((item) => typeof item.correct === "boolean");
    project.accuracy = answeredEvidence.length
      ? Math.round(
          (answeredEvidence.filter((item) => item.correct).length /
            answeredEvidence.length) *
            100,
        )
      : 0;
    project.weakPoints = Array.from(
      new Set(
        allProgress.flatMap((item) =>
          Object.values(item.knowledge ?? {})
            .filter((knowledge) => knowledge.lastOutcome === "needs-review")
            .map((knowledge) => knowledge.label),
        ),
      ),
    ).slice(0, 20);
    project.lastStudied = "刚刚";
    await writeStore(userId, store);
    return sendJson(res, 200, { project, progress });
  }

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

    const store = await readStore(userId);
    const taskId = getRequestTaskId(req, userId);
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
        reportProgress: getRequestProgressReporter(req, userId),
      });
      if (typeof result.data.answer !== "string" || !result.data.answer.trim()) {
        throw new Error("AI 助教未返回有效内容");
      }
      completeGenerationTask(taskId, "助教已经回复");
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
    const store = await readStore(userId);
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

    const completedSection = positions[currentIndex].section;
    const wasAlreadyCompleted = completedSection.status === "done";
    completedSection.status = "done";
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
    if (!wasAlreadyCompleted) {
      project.weeklyMinutes += Math.max(
        1,
        completedSection.estimatedMinutes ?? 20,
      );
    }
    project.lastStudied = "刚刚";
    await writeStore(userId, store);

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
    const store = await readStore(userId);
    const { apiKey: _apiKey, ...safeSettings } = store.aiSettings;
    return sendJson(res, 200, {
      settings: {
        ...safeSettings,
        apiKeyConfigured: Boolean(store.aiSettings.apiKey),
        apiKeyPersisted: isApiKeyPersisted(userId),
        keyProtection: getSecretProtectionStatus(),
      },
    });
  }

  if (req.method === "GET" && pathname === "/api/models") {
    const store = await readStore(userId);
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
    const store = await readStore(userId);

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
      store.aiSettings.apiKey = body.apiKey.trim() || undefined;
    }

    store.aiSettings.provider = "DeepSeek";
    await writeStore(userId, store);
    const { apiKey: _apiKey, ...safeSettings } = store.aiSettings;
    return sendJson(res, 200, {
      settings: {
        ...safeSettings,
        apiKeyConfigured: Boolean(store.aiSettings.apiKey),
        apiKeyPersisted: isApiKeyPersisted(userId),
        keyProtection: getSecretProtectionStatus(),
      },
    });
  }

  if (req.method === "GET" && pathname === "/api/settings/search") {
    const store = await readStore(userId);
    return sendJson(res, 200, {
      settings: {
        provider: store.webSearchSettings.provider,
        apiKeyConfigured: Boolean(store.webSearchSettings.apiKey),
        apiKeyPersisted: isWebSearchApiKeyPersisted(userId),
        keyProtection: getSecretProtectionStatus(),
      },
    });
  }

  if (req.method === "PUT" && pathname === "/api/settings/search") {
    const body = await readJson<{ apiKey?: unknown }>(req);
    const store = await readStore(userId);

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
      store.webSearchSettings.apiKey = body.apiKey.trim() || undefined;
    }

    store.webSearchSettings.provider = "Tavily";
    await writeStore(userId, store);
    return sendJson(res, 200, {
      settings: {
        provider: store.webSearchSettings.provider,
        apiKeyConfigured: Boolean(store.webSearchSettings.apiKey),
        apiKeyPersisted: isWebSearchApiKeyPersisted(userId),
        keyProtection: getSecretProtectionStatus(),
      },
    });
  }

  if (req.method === "POST" && pathname === "/api/search/test") {
    const store = await readStore(userId);
    const result = await searchWeb(store.webSearchSettings, "Web Search API connection test");
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/ai/chat") {
    const body = await readJson<{ message: string; context?: string }>(req);
    const store = await readStore(userId);
    const taskId = getRequestTaskId(req, userId);
    updateGenerationTask(taskId, {
      status: "running",
      stage: "正在连接内容服务",
      detail: "等待服务返回",
      progress: 35,
    });
    const result = await callDeepSeek(store.aiSettings, [
      { role: "system", content: "你是圆趣学习 Web App 的 AI 助教，请用简体中文回答。" },
      { role: "user", content: `${body.context ? `上下文：${body.context}\n` : ""}${body.message}` },
    ]);
    completeGenerationTask(taskId, "内容服务连接正常");
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
    const requestUserId = getAuthenticatedUserId(req);
    if (requestUserId) {
      failGenerationTask(
        getRequestTaskId(req, requestUserId),
        error instanceof Error ? error.message : "服务端发生错误",
      );
    }
    sendJson(res, status, {
      error:
        status >= 500 && !(error instanceof HttpError)
          ? "服务器暂时无法处理请求"
          : error instanceof Error
            ? error.message
            : "服务器错误",
    });
  });
});

server.listen(port, host, () => {
  console.log(`TS backend listening on http://${host}:${port}`);
});
