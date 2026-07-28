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
  overview: string;
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

export type OutlinePreferences = {
  learningGoal?: string;
  currentLevel?: string;
  coveragePreference?: string;
  timeBudget?: string;
  sessionLength?: string;
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
