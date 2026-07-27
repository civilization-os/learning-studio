import { callDeepSeek } from "../deepseek.js";
import { AgentDefinition } from "./types.js";

type TutorHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type TutorLearningContext = {
  phase: "orient" | "understand" | "practice" | "reflect";
  attempt: "idle" | "correct" | "incorrect";
  confidence: "uncertain" | "partial" | "ready" | null;
};

function normaliseLearningContext(value: unknown): TutorLearningContext {
  const input =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const phase = ["orient", "understand", "practice", "reflect"].includes(
    String(input.phase),
  )
    ? (String(input.phase) as TutorLearningContext["phase"])
    : "understand";
  const attempt = ["idle", "correct", "incorrect"].includes(
    String(input.attempt),
  )
    ? (String(input.attempt) as TutorLearningContext["attempt"])
    : "idle";
  const confidence = ["uncertain", "partial", "ready"].includes(
    String(input.confidence),
  )
    ? (String(input.confidence) as NonNullable<TutorLearningContext["confidence"]>)
    : null;
  return { phase, attempt, confidence };
}

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
    const learningContext = normaliseLearningContext(input.learningContext);
    const phaseLabels = {
      orient: "定位知识关系",
      understand: "理解核心机制",
      practice: "主动应用",
      reflect: "收束与反思",
    };
    const attemptLabels = {
      idle: "尚未提交练习",
      correct: "最近一次练习正确",
      incorrect: "最近一次练习错误",
    };
    const confidenceLabels = {
      uncertain: "主观信心不足",
      partial: "部分理解",
      ready: "认为可以独立应用",
    };

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
    const sourceUrls = new Set(
      section.content?.research?.sourceRefs ?? section.sourceRefs ?? [],
    );
    const researchContext = (project.sources ?? [])
      .filter((source) => sourceUrls.has(source.url))
      .map(
        (source, index) =>
          `[${index + 1}] ${source.title}\nURL: ${source.url}\n摘要: ${source.snippet}`,
      )
      .join("\n\n");

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
本节参考资料：${researchContext || "本节暂时没有可用的外部资料"}
当前学习阶段：${phaseLabels[learningContext.phase]}
学习证据：${attemptLabels[learningContext.attempt]}；${
            learningContext.confidence
              ? confidenceLabels[learningContext.confidence]
              : "尚未表达主观信心"
          }

规则：
1. 优先基于本节内容回答；发现课程内容可能有误时要明确指出，不要附和错误；
2. “再讲简单点”要换一种更直观的表达，“举个例子”要给新例子，“总结本节”要输出精炼要点；
3. 在尚未提交练习时，用户请求提示只能给思路或第一级提示，不直接泄露答案；
4. 最近练习错误时，先指出最可能的概念误区，再给最小必要解释，最后追加一个简短检查问题；
5. 最近练习正确时，优先追问理由或给轻量变式，验证不是猜对；
6. 用户要求出题时，只给题目和选项，等用户回答后再公布答案；
7. 回答使用简体中文纯文本，可用短段落和编号，不输出 Markdown 表格；
8. 涉及事实、版本、API 或配置时优先依据本节参考资料；资料不足要明确说明；
9. 不确定的事实要说明不确定，不编造来源或引用。`,
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
        suggestions:
          learningContext.phase === "practice"
            ? learningContext.attempt === "idle"
              ? ["给我一级提示", "帮我排除一个选项", "提醒我用哪个概念"]
              : ["分析我的思路", "给我一道变式题", "让我解释为什么"]
            : learningContext.phase === "reflect"
              ? ["用三个问题检验我", "总结我的薄弱点", "安排一次复习"]
              : ["再讲简单点", "换一个类比", "检查我的理解"],
        recommendedAction:
          learningContext.attempt === "incorrect"
            ? "先修正误区，再完成一道变式练习。"
            : learningContext.attempt === "correct"
              ? "用自己的话解释理由，确认不是猜对。"
              : learningContext.phase === "practice"
                ? "先独立作答，需要时只获取一级提示。"
                : "继续当前学习阶段，并主动复述一个关键点。",
      },
      nextActions: ["继续追问", "完成练习", "进入下一节"],
    };
  },
};
