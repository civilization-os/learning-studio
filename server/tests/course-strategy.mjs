import {
  buildLessonResearchQueries,
  createBaseCourseStrategy,
  formatCourseStrategyForPrompt,
  inferStrategyMode,
} from "../dist/courseStrategy.js";

const mathContext = "考研数学一 函数、极限、连续与积分";
const examMode = inferStrategyMode(
  { learningGoal: "考试或认证", currentLevel: "做过基础练习" },
  mathContext,
);
if (examMode !== "exam") {
  throw new Error("explicit exam goal must select exam strategy");
}
const examStrategy = createBaseCourseStrategy(examMode, mathContext);
const examPurposes = new Set(
  examStrategy.researchIntents.map((intent) => intent.purpose),
);
for (const purpose of ["scope", "tasks", "dependencies", "methods", "pitfalls"]) {
  if (!examPurposes.has(purpose)) {
    throw new Error(`exam strategy is missing ${purpose} research`);
  }
}
if (
  examStrategy.researchIntents.some((intent) =>
    intent.query.includes("当前版本"),
  )
) {
  throw new Error("math exam research must not use software-version boilerplate");
}
const mathLessonQueries = buildLessonResearchQueries({
  strategy: examStrategy,
  projectTitle: "考研数学一",
  chapterTitle: "函数、极限与连续",
  section: {
    id: "math-functions",
    title: "基本初等函数、复合与反函数",
    status: "current",
    outcome: "能够识别函数结构并为后续极限、导数和积分选择变换",
    strategy: {
      role: "bridge",
      whyNow: "函数结构决定后续运算与换元方法。",
      futureUses: ["极限等价变换", "积分换元", "反双曲函数形式识别"],
      successEvidence: ["能够从表达式识别复合、反函数和可用变换"],
      difficulty: {
        primary: "recognition",
        factors: [
          {
            dimension: "recognition",
            level: 3,
            reason: "需要从非标准表达式识别函数结构。",
          },
        ],
      },
    },
  },
});
if (
  !mathLessonQueries.some((intent) => intent.purpose === "dependencies") ||
  !mathLessonQueries.some((intent) => intent.purpose === "methods") ||
  !mathLessonQueries.some((intent) => intent.purpose === "pitfalls")
) {
  throw new Error("exam lesson research must cover dependencies, methods and pitfalls");
}
const examContract = formatCourseStrategyForPrompt(examStrategy);
for (const expected of ["简便", "适用条件", "失效边界", "变式"]) {
  if (!examContract.includes(expected)) {
    throw new Error(`exam classroom contract must include ${expected}`);
  }
}

const workContext = "Apache Flink 生产任务 状态 Checkpoint 与故障恢复";
const workMode = inferStrategyMode(
  { learningGoal: "解决实际问题", currentLevel: "已有实战经验" },
  workContext,
);
if (workMode !== "work") {
  throw new Error("explicit work goal must select work strategy");
}
const workStrategy = createBaseCourseStrategy(workMode, workContext);
const workContract = formatCourseStrategyForPrompt(workStrategy);
for (const expected of ["真实任务", "机制模型", "故障", "验收"]) {
  if (!workContract.includes(expected)) {
    throw new Error(`work classroom contract must include ${expected}`);
  }
}
if (
  !workStrategy.difficultyPriorities.includes("diagnosis") ||
  !workStrategy.difficultyPriorities.includes("tradeoff")
) {
  throw new Error("work strategy must prioritize diagnosis and tradeoff");
}

console.log("course-strategy pressure checks passed");
