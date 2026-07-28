import assert from "node:assert/strict";
import {
  completeGenerationTask,
  createGenerationTask,
  listGenerationTasks,
  subscribeGenerationTasks,
  updateGenerationTask,
} from "../dist/generationTasks.js";

const events = [];
const unsubscribe = subscribeGenerationTasks((task) => events.push({ ...task }));

const task = createGenerationTask({
  type: "course-outline",
  title: "重新规划学习路线",
  projectId: "project-test",
});

assert.equal(task.status, "queued");
assert.equal(task.progress, 0);

updateGenerationTask(task.id, {
  status: "running",
  stage: "正在编排课程路线",
  detail: "从学习结果反推章节",
  progress: 54.4,
});

const running = listGenerationTasks().find((item) => item.id === task.id);
assert.equal(running?.status, "running");
assert.equal(running?.stage, "正在编排课程路线");
assert.equal(running?.progress, 54);

completeGenerationTask(task.id, "新版课程结构已经准备好");
const completed = listGenerationTasks().find((item) => item.id === task.id);
assert.equal(completed?.status, "completed");
assert.equal(completed?.progress, 100);
assert.equal(events.at(-1)?.stage, "已经完成");

unsubscribe();
console.log("generation task tests passed");
