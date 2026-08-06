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

export type OutlinePreferences = {
  learningGoal?: string;
  currentLevel?: string;
  coveragePreference?: string;
  timeBudget?: string;
  sessionLength?: string;
};

export type PreferenceRecommendations = Partial<
  Record<keyof OutlinePreferences, string>
>;

export type CourseStrategyMode =
  | "exam"
  | "work"
  | "academic"
  | "quick-start"
  | "mastery";

export type DifficultyDimension =
  | "recognition"
  | "concept"
  | "procedure"
  | "calculation"
  | "transfer"
  | "diagnosis"
  | "tradeoff";

export type ResearchIntentPurpose =
  | "scope"
  | "tasks"
  | "dependencies"
  | "methods"
  | "pitfalls"
  | "evidence";

export type CourseResearchIntent = {
  purpose: ResearchIntentPurpose;
  query: string;
};

export type CourseStrategy = {
  schemaVersion: 1;
  mode: CourseStrategyMode;
  rationale: string;
  targetEvidence: string[];
  difficultyPriorities: DifficultyDimension[];
  researchIntents: CourseResearchIntent[];
};

export type KnowledgeRole =
  | "foundation"
  | "tool"
  | "bridge"
  | "application"
  | "verification";

export type DifficultyFactor = {
  dimension: DifficultyDimension;
  level: 1 | 2 | 3 | 4 | 5;
  reason: string;
};

export type SectionStrategy = {
  role: KnowledgeRole;
  whyNow: string;
  futureUses: string[];
  successEvidence: string[];
  difficulty: {
    primary: DifficultyDimension;
    factors: DifficultyFactor[];
  };
};

export type LessonMethodPath = {
  name: string;
  principle: string;
  bestFor: string;
  boundary: string;
};

export type LessonLearningDesign = {
  strategyMode: CourseStrategyMode;
  whyNow: string;
  futureUses: string[];
  successCriteria: string[];
  difficultyFocus: string[];
  methodPaths: LessonMethodPath[];
};

export type OutlinePlan = {
  courseType: string;
  targetOutcome: string;
  priorKnowledge: string;
  depth: "intro" | "standard" | "deep";
  estimatedHours: number;
  sessionMinutes: number;
  assumptions: string[];
  researchQueries: string[];
  strategy?: CourseStrategy;
};

export type OutlineAudit = {
  status: "passed" | "adjusted";
  coverage: string;
  granularity: string;
  sequence: string;
  changes: string[];
};

export type LessonSection = {
  id: string;
  title: string;
  status: "done" | "current" | "locked";
  origin?: "ai" | "user";
  kind?: "concept" | "practice" | "project" | "review";
  outcome?: string;
  estimatedMinutes?: number;
  practiceMinutes?: number;
  sourceRefs?: string[];
  strategy?: SectionStrategy;
  content?: LessonContent;
  learningProgress?: LessonProgress;
};

export type LessonScene = {
  id: string;
  type: "prediction" | "concept" | "step-reveal" | "error-diagnosis";
  conceptKey?: string;
  navTitle?: string;
  title: string;
  instruction: string;
  body?: string;
  options?: string[];
  answerIndex?: number;
  hints?: string[];
  feedback?: {
    correct: string;
    incorrect: string;
  };
  remediation?: string;
  misconception?: string;
  challenge?: string;
  steps?: string[];
  takeaway: string;
};

export type LessonSceneEvidence = {
  sceneId: string;
  selectedIndex?: number;
  correct?: boolean;
  attempts: number;
  hintsUsed: number;
  completed: boolean;
  firstTryCorrect?: boolean;
  outcome?: "mastered" | "supported" | "needs-review" | "skipped";
  route?: "standard" | "support" | "fast-track" | "challenge";
  updatedAt: string;
};

export type LessonKnowledgeState = {
  conceptKey: string;
  label: string;
  mastery: number;
  evidenceCount: number;
  correctCount: number;
  attempts: number;
  hintsUsed: number;
  lastOutcome: "mastered" | "supported" | "needs-review";
  misconception?: string;
  lastSeenAt: string;
  nextReviewAt: string;
  /** SM-2 简化：当前间隔天数（1/3/7/15/30） */
  intervalDays?: number;
  /** 已连续答对推进的复习次数 */
  reviewCount?: number;
};

export type LessonReflection = {
  summary: string;
  confidence: "uncertain" | "partial" | "ready";
  tutorFeedback?: string;
  updatedAt: string;
};

export type LessonProgress = {
  schemaVersion: 1;
  currentSceneId?: string;
  completedSceneIds: string[];
  evidence: Record<string, LessonSceneEvidence>;
  knowledge?: Record<string, LessonKnowledgeState>;
  reflection?: LessonReflection;
  updatedAt: string;
};

export type LessonToolbookItem = {
  title: string;
  category:
    | "formula"
    | "rule"
    | "checklist"
    | "command"
    | "template"
    | "reference";
  tier: "remember" | "lookup";
  content: string[];
  useWhen: string;
  boundary: string;
};

export type LessonToolbook = {
  title: string;
  scope: string;
  completenessNote: string;
  items: LessonToolbookItem[];
};

export type ChapterToolCategory =
  | "concept"
  | "formula"
  | "method"
  | "decision"
  | "procedure"
  | "checklist"
  | "pattern"
  | "reference";

export type ChapterToolPlacement =
  | "chapter-core"
  | "chapter-support"
  | "later-bridge";

export type ChapterToolBasis =
  | "course-scope"
  | "reference-structure"
  | "section-outcome"
  | "downstream-dependency";

export type ChapterToolItem = {
  id: string;
  title: string;
  category: ChapterToolCategory;
  placement: ChapterToolPlacement;
  summary: string;
  content: string[];
  useWhen: string;
  boundary: string;
  introducedInSectionId?: string;
  relatedSectionIds: string[];
  usedInSectionIds: string[];
  sourceRefs: string[];
  basis: ChapterToolBasis[];
};

export type ChapterToolLibrary = {
  schemaVersion: 1;
  chapterId: string;
  title: string;
  scope: string;
  generatedAt: string;
  modelName: string;
  outlineFingerprint: string;
  sourceRefs: string[];
  items: ChapterToolItem[];
  generation: {
    webSearchUsed: boolean;
    researchQueries: string[];
    coverageAreas: string[];
    passes: Array<"scope" | "research" | "inventory" | "dependencies" | "review">;
    warning?: string;
  };
};

export type VisualElementFormat =
  | "latex"
  | "mermaid"
  | "code"
  | "table"
  | "flashcard";

export type VisualElement = {
  format: VisualElementFormat;
  caption?: string;
  content: string;
  language?: string;
};

export type InteractiveDemoType = "slider" | "step-animation" | "compare";

export type InteractiveSliderParam = {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
};

/**
 * 可交互演示块（学科中立，渲染器只认类型不认学科）：
 * - slider: 可拖参数改变曲线的图形（如函数/趋势/模型），参数变化实时重绘
 * - step-animation: 步骤推进动画（推导、流程、时间线、过程）
 * - compare: 对照/切换（概念对比、方案对比、对象属性对比）
 */
export type InteractiveDemo =
  | {
      type: "slider";
      title: string;
      instruction: string;
      /** 函数表达式，支持 x 与 params 中的参数名，如 a*x^2 + b*x + c */
      expression: string;
      xLabel?: string;
      yLabel?: string;
      xMin: number;
      xMax: number;
      yMin?: number;
      yMax?: number;
      params: InteractiveSliderParam[];
      note?: string;
    }
  | {
      type: "step-animation";
      title: string;
      instruction?: string;
      steps: Array<{ title: string; body: string }>;
    }
  | {
      type: "compare";
      title: string;
      instruction?: string;
      columns: Array<{ label: string; items: string[] }>;
    };

export type ExerciseType =
  | "single-choice"
  | "true-false"
  | "fill-blank"
  | "calculation"
  | "explanation";

/**
 * 多题型练习。字段按 type 取用：
 * - single-choice: options(4) + answerIndex
 * - true-false: answer(boolean)
 * - fill-blank: acceptedAnswers（关键词/答案列表，忽略大小写匹配）
 * - calculation: acceptedResult（结果及等价写法，忽略大小写与空白匹配）
 * - explanation: referencePoints（判分参考要点）
 */
export type ExerciseItem = {
  type: ExerciseType;
  knowledgePoint: string;
  purpose?: string;
  difficultyFocus?: string;
  question: string;
  explanation?: string;
  options?: string[];
  answerIndex?: number;
  answer?: boolean;
  acceptedAnswers?: string[];
  acceptedResult?: string[];
  referencePoints?: string[];
  transferPrompt?: string;
};

export type LessonContent = {
  generatedAt: string;
  modelName: string;
  research?: {
    sourceRefs: string[];
    query: string;
    searchedAt: string;
    webSearchUsed: boolean;
    warning?: string;
  };
  learningDesign?: LessonLearningDesign;
  toolbook?: LessonToolbook;
  overview: string;
  visualElements?: VisualElement[];
  interactiveDemos?: InteractiveDemo[];
  scenes?: LessonScene[];
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
  /** 兼容旧数据的单题（单选）；新内容优先使用 exercises */
  exercise?: {
    question: string;
    options: string[];
    answerIndex: number;
    explanation: string;
  };
  exercises?: ExerciseItem[];
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
  toolLibrary?: ChapterToolLibrary;
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
  outlinePreferences?: OutlinePreferences;
  outlinePlan?: OutlinePlan;
  outlineAudit?: OutlineAudit;
  sources?: WebSource[];
  generation?: {
    webSearchUsed: boolean;
    generatedAt: string;
    query: string;
    warning?: string;
    outlineStatus?: "ready" | "draft" | "fallback";
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
