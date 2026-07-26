import { createId } from "./lib/id";

export type ModelSettings = {
  provider: "DeepSeek";
  modelName: string;
  baseUrl: string;
  apiKey: string;
  webSearchProvider: "Tavily";
  webSearchApiKey: string;
  explanationDepth: "简单" | "标准" | "深入";
  questionDifficulty: "基础" | "提高" | "综合";
  answerLength: "简短" | "适中" | "详细";
};

export type LessonSection = {
  id: string;
  title: string;
  status: "done" | "current" | "locked";
  origin?: "ai" | "user";
  kind?: "concept" | "practice" | "project" | "review";
  outcome?: string;
  content?: LessonContent;
};

export type LessonContent = {
  generatedAt: string;
  modelName: string;
  overview: string;
  mindMap: {
    center: string;
    branches: Array<{
      title: string;
      details: string[];
    }>;
  };
  explanation: {
    lead: string;
    paragraphs: string[];
    keyPoints: string[];
  };
  example: {
    title: string;
    scenario: string;
    steps: string[];
    result: string;
    code?: string;
  };
  exercise: {
    question: string;
    options: string[];
    answerIndex: number;
    explanation: string;
  };
};

export type CourseChapter = {
  id: string;
  title: string;
  origin?: "ai" | "user";
  sections: LessonSection[];
  difficulty?: 1 | 2 | 3 | 4 | 5;
  objective?: string;
  prerequisites?: string[];
  estimatedHours?: number;
};

export type WebSource = {
  title: string;
  url: string;
  snippet: string;
  score?: number;
};

export type LearningProject = {
  id: string;
  title: string;
  description: string;
  progress: number;
  lastStudied: string;
  pendingTasks: number;
  weeklyMinutes: number;
  accuracy: number;
  weakPoints: string[];
  chapters: CourseChapter[];
  outlineSummary?: {
    audience: string;
    courseGoal: string;
    estimatedHours: number;
  };
  sources?: WebSource[];
  generation?: {
    webSearchUsed: boolean;
    generatedAt: string;
    query: string;
    warning?: string;
  };
};

export type StudyState = {
  modelSettings: ModelSettings;
  projects: LearningProject[];
  activeProjectId: string;
  activeChapterId: string;
  activeSectionId: string;
};

export const defaultState: StudyState = {
  modelSettings: {
    provider: "DeepSeek",
    modelName: "",
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    webSearchProvider: "Tavily",
    webSearchApiKey: "",
    explanationDepth: "标准",
    questionDifficulty: "基础",
    answerLength: "适中",
  },
  projects: [],
  activeProjectId: "",
  activeChapterId: "",
  activeSectionId: "",
};

export function createProjectFromGoal(input: { topic: string; description: string }): LearningProject {
  const title = input.topic.trim() || "新的学习项目";
  const description = input.description.trim() || `围绕「${title}」生成可执行的学习大纲。`;

  return {
    id: createId(),
    title,
    description,
    progress: 0,
    lastStudied: "刚刚创建",
    pendingTasks: 0,
    weeklyMinutes: 0,
    accuracy: 0,
    weakPoints: [],
    chapters: [
      {
        id: createId(),
        title: "第一章 基础认知",
        origin: "ai",
        sections: [
          { id: createId(), title: "核心概念", status: "current", origin: "ai" },
          { id: createId(), title: "基本方法", status: "locked", origin: "ai" },
        ],
      },
      {
        id: createId(),
        title: "第二章 应用练习",
        origin: "ai",
        sections: [
          { id: createId(), title: "典型例题", status: "locked", origin: "ai" },
          { id: createId(), title: "综合训练", status: "locked", origin: "ai" },
        ],
      },
    ],
  };
}
