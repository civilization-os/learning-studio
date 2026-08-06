import assert from "node:assert/strict";
import {
  completeGenerationTask,
  createGenerationTask,
  listGenerationTasks,
  subscribeGenerationTasks,
  updateGenerationTask,
} from "../dist/generationTasks.js";

const events = [];
const unsubscribe = subscribeGenerationTasks("user-a", (task) => events.push({ ...task }));

const task = createGenerationTask({
  userId: "user-a",
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

const running = listGenerationTasks("user-a").find((item) => item.id === task.id);
assert.equal(running?.status, "running");
assert.equal(running?.stage, "正在编排课程路线");
assert.equal(running?.progress, 54);

completeGenerationTask(task.id, "新版课程结构已经准备好");
const completed = listGenerationTasks("user-a").find((item) => item.id === task.id);
assert.equal(completed?.status, "completed");
assert.equal(completed?.progress, 100);
assert.equal(events.at(-1)?.stage, "已经完成");

const otherUserTask = createGenerationTask({
  userId: "user-b",
  type: "course-outline",
  title: "另一个用户的学习路线",
  projectId: "project-test",
});
assert.notEqual(otherUserTask.id, task.id);
assert.equal(listGenerationTasks("user-a").some((item) => item.id === otherUserTask.id), false);
assert.equal(events.some((event) => event.id === otherUserTask.id), false);

unsubscribe();
console.log("generation task tests passed");
