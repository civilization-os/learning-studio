import { randomBytes } from "node:crypto";

export type GenerationTaskType =
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

export type GenerationTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationTask = {
  id: string;
  type: GenerationTaskType;
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

export type GenerationProgress = Pick<
  GenerationTask,
  "stage" | "detail" | "progress" | "completedUnits" | "totalUnits"
>;

type TaskListener = (task: GenerationTask) => void;

const tasks = new Map<string, GenerationTask>();
const listeners = new Set<TaskListener>();
const maxTaskHistory = 80;

function createId() {
  return `generation-${Date.now()}-${randomBytes(6).toString("hex")}`;
}

function publish(task: GenerationTask) {
  for (const listener of listeners) listener(task);
}

function trimHistory() {
  if (tasks.size <= maxTaskHistory) return;
  const removable = Array.from(tasks.values())
    .filter((task) => task.status !== "running" && task.status !== "queued")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const task of removable.slice(0, tasks.size - maxTaskHistory)) {
    tasks.delete(task.id);
  }
}

export function createGenerationTask(input: {
  type: GenerationTaskType;
  title: string;
  projectId?: string;
  chapterId?: string;
  sectionId?: string;
}): GenerationTask {
  const now = new Date().toISOString();
  const task: GenerationTask = {
    id: createId(),
    type: input.type,
    title: input.title.trim().slice(0, 120) || "准备内容",
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    ...(input.sectionId ? { sectionId: input.sectionId } : {}),
    status: "queued",
    stage: "等待开始",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  tasks.set(task.id, task);
  trimHistory();
  publish(task);
  return task;
}

export function getGenerationTask(taskId: string | undefined) {
  return taskId ? tasks.get(taskId) : undefined;
}

export function listGenerationTasks() {
  return Array.from(tasks.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function updateGenerationTask(
  taskId: string | undefined,
  update: Partial<GenerationProgress> & {
    status?: GenerationTaskStatus;
    error?: string;
  },
) {
  const task = getGenerationTask(taskId);
  if (!task || ["completed", "failed", "cancelled"].includes(task.status)) {
    return task;
  }
  const now = new Date().toISOString();
  Object.assign(task, update, {
    updatedAt: now,
    ...(!task.startedAt && update.status !== "queued"
      ? { startedAt: now }
      : {}),
  });
  if (typeof task.progress === "number") {
    task.progress = Math.max(0, Math.min(100, Math.round(task.progress)));
  }
  publish(task);
  return task;
}

export function completeGenerationTask(
  taskId: string | undefined,
  detail = "内容已经准备好",
) {
  const task = getGenerationTask(taskId);
  if (!task || ["failed", "cancelled"].includes(task.status)) return task;
  const now = new Date().toISOString();
  Object.assign(task, {
    status: "completed" as const,
    stage: "已经完成",
    detail,
    progress: 100,
    updatedAt: now,
    completedAt: now,
    startedAt: task.startedAt ?? now,
  });
  publish(task);
  return task;
}

export function failGenerationTask(
  taskId: string | undefined,
  error: string,
) {
  const task = getGenerationTask(taskId);
  if (!task || ["completed", "cancelled"].includes(task.status)) return task;
  const now = new Date().toISOString();
  Object.assign(task, {
    status: "failed" as const,
    stage: "没有完成",
    detail: "可以检查原因后再试一次",
    error: error.slice(0, 500),
    updatedAt: now,
    completedAt: now,
    startedAt: task.startedAt ?? now,
  });
  publish(task);
  return task;
}

export function subscribeGenerationTasks(listener: TaskListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
