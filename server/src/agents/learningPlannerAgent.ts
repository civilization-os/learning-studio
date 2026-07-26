import { AgentDefinition } from "./types.js";

export const learningPlannerAgent: AgentDefinition = {
  name: "learning-planner",
  displayName: "学习状态/复习规划 Agent",
  description: "根据项目进度、正确率和薄弱点生成计划、复习和统计建议。",
  async run(_input, context) {
    const project = context.project;

    return {
      agent: "learning-planner",
      summary: "已准备学习状态与复习规划。",
      data: {
        progress: project?.progress ?? 0,
        accuracy: project?.accuracy ?? 0,
        weakPoints: project?.weakPoints ?? [],
        todayPlan: [],
        reviewPlan: [],
      },
      nextActions: ["生成今日计划", "生成复习建议", "更新项目详情统计"],
    };
  },
};
