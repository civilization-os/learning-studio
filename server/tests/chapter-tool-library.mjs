import assert from "node:assert/strict";
import {
  buildChapterToolResearchQueries,
  createChapterToolLibraryFingerprint,
  isConcreteChapterToolContent,
  normaliseChapterToolContent,
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

const groupedMathContent = normaliseChapterToolContent({
  definition: "若极限存在，则极限值唯一。",
  properties: ["局部有界性", "局部保号性"],
  arithmetic: {
    sum: "lim(f+g)=lim f+lim g",
    product: "lim(fg)=lim f·lim g",
  },
});
assert.ok(
  groupedMathContent.length >= 5 &&
    groupedMathContent.some((item) => item.includes("lim(f+g)")) &&
    groupedMathContent.some((item) => item.includes("局部有界性")),
  "数学工具内容按对象分组时也应保留公式和性质",
);
assert.deepEqual(
  normaliseChapterToolContent("洛必达法则使用前必须先确认未定式类型。"),
  ["洛必达法则使用前必须先确认未定式类型。"],
  "单段实际内容也应转换为可查用条目",
);
assert.deepEqual(
  normaliseChapterToolContent({ definition: "", properties: [] }),
  [],
  "真正没有内容的工具仍应被拒绝",
);

assert.equal(
  isConcreteChapterToolContent(
    ["能确定函数定义域、值域，判断有界性、单调性、周期性和奇偶性"],
    ["能确定函数定义域、值域，判断有界性、单调性、周期性和奇偶性"],
  ),
  false,
  "学习目标不能冒充工具书正文",
);
assert.equal(
  isConcreteChapterToolContent([
    "定义域：使函数表达式有意义的全部自变量取值组成的集合。",
    "偶函数判定：定义域关于原点对称，且对任意 x 都有 f(-x)=f(x)。",
  ]),
  true,
  "完整定义、判定条件和公式应被视为可直接查用的工具内容",
);
assert.equal(
  isConcreteChapterToolContent([
    "这是依据课程小节学习成果建立的基础条目，具体公式与条件以课堂讲解和参考资料为准。",
  ]),
  false,
  "占位说明不能被视为工具书正文",
);

console.log("chapter tool library tests passed");
