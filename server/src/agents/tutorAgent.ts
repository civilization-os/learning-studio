import { callDeepSeek } from "../deepseek.js";
import { AgentDefinition } from "./types.js";

type TutorHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

function normaliseHistory(value: unknown): TutorHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is TutorHistoryItem =>
        item !== null &&
        typeof item === "object" &&
        "role" in item &&
        (item.role === "user" || item.role === "assistant") &&
        "content" in item &&
        typeof item.content === "string" &&
        Boolean(item.content.trim()),
    )
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 1200),
    }));
}

export const tutorAgent: AgentDefinition = {
  name: "tutor",
  displayName: "AI 助教对话 Agent",
  description: "结合当前项目、章节、小节和已生成课程内容进行连续问答。",
  async run(input, context) {
    const project = context.project;
    if (!project) throw new Error("课程项目不存在");

    const sectionId = String(input.sectionId ?? "");
    const chapter = project.chapters.find((item) =>
      item.sections.some((section) => section.id === sectionId),
    );
    const section = chapter?.sections.find((item) => item.id === sectionId);
    if (!chapter || !section) throw new Error("当前学习小节不存在");
    if (!context.store.aiSettings.apiKey) {
      throw new Error("请先在设置中配置 DeepSeek API Key");
    }
    if (!context.store.aiSettings.modelName.trim()) {
      throw new Error("请先从 DeepSeek 官方列表选择模型");
    }

    const message = String(input.message ?? "").trim();
    if (!message) throw new Error("请输入想问的问题");
    if (message.length > 2000) throw new Error("问题不能超过 2000 个字符");
    const history = normaliseHistory(input.history);

    const lessonContext = section.content
      ? JSON.stringify({
          overview: section.content.overview,
          mindMap: section.content.mindMap,
          explanation: section.content.explanation,
          example: section.content.example,
          exercise: {
            question: section.content.exercise.question,
            options: section.content.exercise.options,
          },
        })
      : "本节课程内容尚未生成";

    const response = await callDeepSeek(
      context.store.aiSettings,
      [
        {
          role: "system",
          content: `你是耐心、严谨的中文 AI 助教，只围绕当前课程提供帮助。

课程：${project.title}
章节：${chapter.title}
小节：${section.title}
本节目标：${section.outcome ?? "掌握并应用本节核心知识"}
本节内容：${lessonContext}

规则：
1. 优先基于本节内容回答；发现课程内容可能有误时要明确指出，不要附和错误；
2. “再讲简单点”要换一种更直观的表达，“举个例子”要给新例子，“总结本节”要输出精炼要点；
3. 用户要求出题时，只给题目和选项，等用户回答后再公布答案；
4. 回答使用简体中文纯文本，可用短段落和编号，不输出 Markdown 表格；
5. 不确定的事实要说明不确定，不编造来源。`,
        },
        ...history,
        { role: "user", content: message },
      ],
      { temperature: 0.35 },
    );
    if (response.mocked) {
      throw new Error("DeepSeek 尚未完成配置");
    }
    const answer = response.content.trim();
    if (!answer) throw new Error("AI 助教未返回有效内容");

    return {
      agent: "tutor",
      summary: "AI 助教已回答当前问题。",
      data: {
        answer,
        suggestions: ["再讲简单点", "给我出一道题", "举个例子", "总结本节"],
      },
      nextActions: ["继续追问", "完成练习", "进入下一节"],
    };
  },
};
