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

export type OutlinePolishPatch = {
  id: string;
  type: "chapter" | "section";
  title: string;
  objective?: string;
  outcome?: string;
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

export type AiSettings = {
  provider: "DeepSeek";
  modelName: string;
  baseUrl: string;
  apiKey?: string;
};

export type WebSearchSettings = {
  provider: "Tavily";
  apiKey?: string;
};

export type AppStore = {
  projects: LearningProject[];
  aiSettings: AiSettings;
  webSearchSettings: WebSearchSettings;
};

export type AgentName =
  | "project-creator"
  | "outline"
  | "course-content"
  | "exercise"
  | "tutor"
  | "learning-planner";

export type AgentRunRequest = {
  agent: AgentName;
  input: Record<string, unknown>;
  projectId?: string;
};

export type AgentRunResult = {
  agent: AgentName;
  summary: string;
  data: Record<string, unknown>;
  nextActions: string[];
};
