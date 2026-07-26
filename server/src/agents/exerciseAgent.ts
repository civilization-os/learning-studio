import { AgentDefinition } from "./types.js";

export const exerciseAgent: AgentDefinition = {
  name: "exercise",
  displayName: "练习出题 Agent",
  description: "根据当前小节生成练习题、答案和解析。",
  async run(input) {
    return {
      agent: "exercise",
      summary: "已准备练习题生成结构。",
      data: {
        difficulty: input.difficulty ?? "基础",
        question: "",
        options: [],
        answer: "",
        explanation: "",
      },
      nextActions: ["生成题目", "提交答案", "加入题集"],
    };
  },
};
