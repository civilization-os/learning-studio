import assert from "node:assert/strict";
import {
  buildChapterToolResearchQueries,
  createChapterToolLibraryFingerprint,
} from "../dist/agents/chapterToolLibraryAgent.js";

function createProject() {
  return {
    id: "project-math",
    title: "考研数学",
    description: "按题型和原理学习高等数学",
    progress: 0,
    lastStudied: "",
    pendingTasks: 0,
    weeklyMinutes: 0,
    accuracy: 0,
    weakPoints: [],
    outlinePlan: {
      courseType: "考试复习",
      targetOutcome: "能够识别题型并选择合适方法",
      priorKnowledge: "大学数学基础",
      depth: "deep",
      estimatedHours: 120,
      sessionMinutes: 60,
      assumptions: [],
      strategy: {
        schemaVersion: 1,
        mode: "exam",
        rationale: "针对考试复习",
        targetEvidence: [],
        difficultyPriorities: [],
        researchIntents: [],
      },
    },
    chapters: [
      {
        id: "chapter-limit",
        title: "函数、极限与连续",
        objective: "掌握极限计算和连续性判断",
        sections: [
          {
            id: "section-equivalent",
            title: "等价无穷小",
            status: "current",
            outcome: "能够判断替换条件并完成极限计算",
          },
        ],
      },
      {
        id: "chapter-series",
        title: "无穷级数",
        objective: "掌握级数判敛和函数展开",
        sections: [
          {
            id: "section-taylor",
            title: "泰勒公式与幂级数展开",
            status: "locked",
            outcome: "能够使用局部展开处理近似和级数问题",
          },
        ],
      },
    ],
  };
}

const project = createProject();
const queries = buildChapterToolResearchQueries(project, "chapter-limit");

assert.ok(queries.length >= 5, "应从多个角度生成检索词");
assert.ok(
  queries.some(
    (query) =>
      query.includes("函数、极限与连续") &&
      query.includes("泰勒公式与幂级数展开"),
  ),
  "应把后续课程节点带入依赖检索，而不是只看当前小节",
);
assert.ok(
  queries.some((query) => query.includes("考试题型")),
  "考试方向应增加题型与方法选择检索",
);

const firstFingerprint = createChapterToolLibraryFingerprint(
  project,
  "chapter-limit",
);
assert.equal(
  firstFingerprint,
  createChapterToolLibraryFingerprint(project, "chapter-limit"),
  "同一课程结构应得到稳定指纹",
);

const changedProject = structuredClone(project);
changedProject.chapters[1].sections[0].outcome =
  "能够使用展开处理积分、近似和误差估计";
assert.notEqual(
  firstFingerprint,
  createChapterToolLibraryFingerprint(changedProject, "chapter-limit"),
  "后续课程变化后应让已有章级工具库失效",
);

const engineeringProject = createProject();
engineeringProject.title = "Flink 工程实践";
engineeringProject.outlinePlan.strategy.mode = "work";
engineeringProject.chapters[0].title = "状态与容错";
engineeringProject.chapters[1].title = "生产排错";
engineeringProject.chapters[1].sections[0].title = "故障恢复演练";
const engineeringQueries = buildChapterToolResearchQueries(
  engineeringProject,
  "chapter-limit",
);
assert.ok(
  engineeringQueries.some((query) => query.includes("官方文档")),
  "工作方向应增加官方文档、实践和排错检索",
);
assert.ok(
  engineeringQueries.every((query) => !query.includes("泰勒")),
  "检索词应由课程内容推导，不能写死某个学科工具",
);

console.log("chapter tool library tests passed");
