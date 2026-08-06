import { learningPlannerAgent } from "../dist/agents/learningPlannerAgent.js";

const now = new Date();
const past = new Date(now); past.setDate(past.getDate() - 5);
const future = new Date(now); future.setDate(future.getDate() + 10);

const project = {
  id: "p1", title: "微积分入门", description: "x", progress: 40, accuracy: 70,
  lastStudied: now.toISOString(), pendingTasks: 2, weeklyMinutes: 60, weakPoints: ["导数"],
  chapters: [{
    id: "c1", title: "第一章", sections: [
      {
        id: "s1", title: "导数", status: "done",
        learningProgress: {
          schemaVersion: 1, completedSceneIds: [], evidence: {}, updatedAt: now.toISOString(),
          knowledge: {
            "k1": { conceptKey: "k1", label: "基本求导公式", mastery: 0.45, evidenceCount: 2, correctCount: 1, attempts: 2, hintsUsed: 1, lastOutcome: "needs-review", lastSeenAt: past.toISOString(), nextReviewAt: past.toISOString(), intervalDays: 1, reviewCount: 0 },
            "k2": { conceptKey: "k2", label: "复合函数求导", mastery: 0.9, evidenceCount: 3, correctCount: 3, attempts: 3, hintsUsed: 0, lastOutcome: "mastered", lastSeenAt: now.toISOString(), nextReviewAt: future.toISOString(), intervalDays: 30, reviewCount: 3 },
          }
        }
      },
      { id: "s2", title: "积分", status: "current", learningProgress: undefined }
    ]
  }]
};

const result = await learningPlannerAgent.run({}, { store: { aiSettings: { provider: "DeepSeek", modelName: "x", baseUrl: "x" }, webSearchSettings: { provider: "Tavily" }, projects: [project] }, project, reportProgress: () => {} });

function check(condition, message) {
  if (!condition) throw new Error(`learning planner smoke: ${message}`);
  console.log("ok:", message);
}

check(result.data.dueTodayCount === 1, "恰好 1 个小节到期");
check(result.data.totalDue === 1, "到期知识点总数为 1");
check(result.data.totalKnowledge === 2, "知识点总数为 2");
check(result.data.todayPlan[0]?.sectionId === "s1", "todayPlan 指向 s1");
check(result.data.todayPlan[0]?.dueCount === 1, "s1 有 1 个到期知识点");
check(result.data.upcoming.length === 0, "upcoming 仅包含无到期项的小节（s1 已到期，s2 无记录）");
check(result.data.weakItems.some((item) => item.label === "基本求导公式"), "weakItems 含薄弱知识点");
check(result.summary.includes("1 个知识点到期"), "summary 文案正确");
console.log("learning planner smoke passed");
