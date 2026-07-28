import {
  CourseResearchIntent,
  CourseStrategy,
  CourseStrategyMode,
  DifficultyDimension,
  LessonSection,
  OutlinePreferences,
} from "./types.js";

type StrategyPolicy = {
  label: string;
  objective: string;
  targetEvidence: string[];
  difficultyPriorities: DifficultyDimension[];
  researchPurposes: CourseResearchIntent["purpose"][];
  classroomContract: string[];
  tutorContract: string[];
};

export const strategyPolicies: Record<CourseStrategyMode, StrategyPolicy> = {
  exam: {
    label: "考试与认证",
    objective: "在有限时间内识别题型、选择方法、稳定执行并处理变式。",
    targetEvidence: [
      "能从题干条件识别题型和主要难点",
      "能比较常规方法、原理方法与简便方法并说明适用边界",
      "能独立完成典型题并迁移到变式或混合题",
    ],
    difficultyPriorities: [
      "recognition",
      "procedure",
      "calculation",
      "transfer",
    ],
    researchPurposes: [
      "scope",
      "tasks",
      "dependencies",
      "methods",
      "pitfalls",
    ],
    classroomContract: [
      "先冷启动判断题型、条件或突破口，再展开讲解",
      "明确难点来自识别、概念、过程、计算还是迁移",
      "至少比较一条稳妥方法与一条更接近原理或更简便的方法",
      "每条方法同时给出适用条件、失效边界与常见失分点",
      "用变式或混合题验证迁移，不以看懂例题作为完成证据",
    ],
    tutorContract: [
      "先判断错误属于题型识别、条件遗漏、概念、步骤、计算或迁移",
      "优先提示关键条件或方法选择，不直接泄露完整答案",
      "用户做对后用变式或反问验证其不是猜对",
    ],
  },
  work: {
    label: "工作与真实问题",
    objective: "在真实约束下完成任务、解释决策、诊断失败并验证结果。",
    targetEvidence: [
      "能完成一个可运行或可交付的任务",
      "能解释机制、约束与方案取舍",
      "能从现象和可观测数据定位故障并验证恢复",
    ],
    difficultyPriorities: ["concept", "diagnosis", "tradeoff", "transfer"],
    researchPurposes: [
      "scope",
      "tasks",
      "dependencies",
      "pitfalls",
      "evidence",
    ],
    classroomContract: [
      "从真实任务、约束或故障现象开始",
      "建立能预测系统行为的机制模型",
      "给出最小可运行实现，并明确生产化还缺什么",
      "比较可选方案、代价和失效边界",
      "通过故障注入、观测、诊断与验收标准验证",
    ],
    tutorContract: [
      "先确认现象、约束、预期结果和已有观测证据",
      "用机制解释原因，再给最小排查或实现步骤",
      "明确方案代价、风险和验证方式",
    ],
  },
  academic: {
    label: "学术基础与研究",
    objective: "理解定义和假设，能够推导、论证、反驳并连接相关理论。",
    targetEvidence: [
      "能准确陈述定义、假设与结论",
      "能完成关键推导或证明",
      "能构造反例并比较相邻理论",
    ],
    difficultyPriorities: ["concept", "procedure", "transfer", "tradeoff"],
    researchPurposes: [
      "scope",
      "dependencies",
      "methods",
      "evidence",
    ],
    classroomContract: [
      "从问题背景进入定义、假设和关键结论",
      "保留必要推导或证明，不用结论代替理由",
      "提供边界反例并连接相邻理论",
      "以准确表述、推导、反驳和开放问题作为验证",
    ],
    tutorContract: [
      "优先追问定义、假设或推导中断点",
      "区分直觉解释与严格论证",
      "通过反例或相邻理论检查理解边界",
    ],
  },
  "quick-start": {
    label: "快速入门",
    objective: "用最少必要知识完成第一个可靠结果，并保留正确的深入入口。",
    targetEvidence: [
      "能独立复现第一个可用结果",
      "知道一个常见风险和验证方法",
      "知道下一步应补齐的知识入口",
    ],
    difficultyPriorities: ["recognition", "procedure", "concept"],
    researchPurposes: ["scope", "tasks", "pitfalls", "evidence"],
    classroomContract: [
      "从一个最小任务开始，只引入完成它必需的模型",
      "提供可跟随操作与结果验证",
      "说明最常见护栏，并给出继续深入的地图",
    ],
    tutorContract: [
      "给最短可执行路径，同时保留必要安全边界",
      "先帮助得到可验证结果，再解释最关键机制",
      "避免一次扩展过多支线",
    ],
  },
  mastery: {
    label: "系统掌握",
    objective: "建立完整主干、关键桥梁、多种表示和跨场景迁移能力。",
    targetEvidence: [
      "能解释知识主干与关键依赖",
      "能在多种表示和方法之间转换",
      "能比较、诊断并完成综合迁移任务",
    ],
    difficultyPriorities: [
      "concept",
      "procedure",
      "transfer",
      "diagnosis",
      "tradeoff",
    ],
    researchPurposes: [
      "scope",
      "dependencies",
      "methods",
      "pitfalls",
      "evidence",
    ],
    classroomContract: [
      "显式建立知识主干、桥梁和后续用途",
      "比较多种表示与方法，保留必要推导",
      "使用边界反例、累计应用与综合任务验证",
      "明确必学、扩展与略过内容及理由",
    ],
    tutorContract: [
      "定位知识图中的断点，而不是只解释当前一句",
      "要求用户连接前置、当前与后续用途",
      "通过比较、诊断和跨场景迁移验证掌握",
    ],
  },
};

const learningGoalModes: Array<[RegExp, CourseStrategyMode]> = [
  [/考试|认证|考研|高考|公考|面试|刷题/, "exam"],
  [/解决实际问题|工作|项目|生产|实战|岗位/, "work"],
  [/研究|论文|学术|理论推导/, "academic"],
  [/快速入门|尽快上手|先跑起来/, "quick-start"],
  [/系统掌握|完整掌握|体系/, "mastery"],
];

export function inferStrategyMode(
  preferences: OutlinePreferences,
  contextText: string,
): CourseStrategyMode {
  const explicit = preferences.learningGoal?.trim() ?? "";
  for (const [pattern, mode] of learningGoalModes) {
    if (pattern.test(explicit)) return mode;
  }
  const context = `${explicit} ${contextText}`;
  for (const [pattern, mode] of learningGoalModes) {
    if (pattern.test(context)) return mode;
  }
  return "mastery";
}

export function createBaseCourseStrategy(
  mode: CourseStrategyMode,
  contextText: string,
): CourseStrategy {
  const policy = strategyPolicies[mode];
  const researchIntents = policy.researchPurposes.map((purpose) => ({
    purpose,
    query: buildCourseResearchQuery(mode, purpose, contextText),
  }));
  return {
    schemaVersion: 1,
    mode,
    rationale: `本课程以“${policy.label}”为主要目标，因此优先优化：${policy.objective}`,
    targetEvidence: policy.targetEvidence,
    difficultyPriorities: policy.difficultyPriorities,
    researchIntents,
  };
}

function buildCourseResearchQuery(
  mode: CourseStrategyMode,
  purpose: CourseResearchIntent["purpose"],
  contextText: string,
): string {
  const compact = contextText.replace(/\s+/g, " ").trim().slice(0, 180);
  const suffixes: Record<
    CourseStrategyMode,
    Record<CourseResearchIntent["purpose"], string>
  > = {
    exam: {
      scope: "考试大纲 官方范围 权威教材",
      tasks: "历年真题 题型 分值 难度",
      dependencies: "知识依赖 后续题型 隐含桥梁",
      methods: "典型题 方法比较 简便方法 适用条件",
      pitfalls: "易错点 失分原因 变式 陷阱",
      evidence: "评分标准 标准解答 能力要求",
    },
    work: {
      scope: "官方文档 稳定版本 核心范围",
      tasks: "真实项目 生产实践 典型任务",
      dependencies: "机制依赖 架构关系 前置知识",
      methods: "实现方案 最佳实践 权衡",
      pitfalls: "故障案例 常见错误 失效边界",
      evidence: "验收标准 可观测性 性能验证",
    },
    academic: {
      scope: "权威教材 课程范围 综述",
      tasks: "经典问题 研究问题",
      dependencies: "理论依赖 先修知识 后续用途",
      methods: "证明方法 推导方法 方法比较",
      pitfalls: "反例 边界条件 常见误解",
      evidence: "原始论文 定理证明 实证证据",
    },
    "quick-start": {
      scope: "入门路线 最小必要知识",
      tasks: "首个任务 快速开始 示例",
      dependencies: "必要前置 下一步路线",
      methods: "最短实现 操作步骤",
      pitfalls: "常见错误 安全护栏",
      evidence: "验证结果 完成标准",
    },
    mastery: {
      scope: "权威教材 知识体系 课程范围",
      tasks: "典型应用 综合任务",
      dependencies: "知识图谱 前置依赖 后续用途 隐含桥梁",
      methods: "方法比较 多种表示 推导",
      pitfalls: "边界 反例 常见误区",
      evidence: "能力目标 迁移任务 验证标准",
    },
  };
  return `${compact} ${suffixes[mode][purpose]}`.trim().slice(0, 240);
}

export function mergeCourseStrategy(
  generated: Partial<CourseStrategy> | undefined,
  base: CourseStrategy,
): CourseStrategy {
  const uniqueStrings = (items: unknown, fallback: string[], limit: number) =>
    Array.isArray(items)
      ? Array.from(
          new Set(
            items
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim().slice(0, 240))
              .filter(Boolean),
          ),
        ).slice(0, limit)
      : fallback;
  const allowedDimensions = new Set<DifficultyDimension>([
    "recognition",
    "concept",
    "procedure",
    "calculation",
    "transfer",
    "diagnosis",
    "tradeoff",
  ]);
  const generatedPriorities = Array.isArray(generated?.difficultyPriorities)
    ? generated.difficultyPriorities.filter((item) =>
        allowedDimensions.has(item as DifficultyDimension),
      )
    : [];
  const intents = Array.isArray(generated?.researchIntents)
    ? generated.researchIntents
        .filter(
          (item): item is CourseResearchIntent =>
            Boolean(
              item &&
                base.researchIntents.some(
                  (baseIntent) => baseIntent.purpose === item.purpose,
                ) &&
                typeof item.query === "string" &&
                item.query.trim(),
            ),
        )
        .map((item) => ({
          purpose: item.purpose,
          query: item.query.trim().slice(0, 240),
        }))
    : [];
  const byPurpose = new Map(
    [...base.researchIntents, ...intents].map((intent) => [
      intent.purpose,
      intent,
    ]),
  );
  return {
    schemaVersion: 1,
    mode: base.mode,
    rationale:
      typeof generated?.rationale === "string" && generated.rationale.trim()
        ? generated.rationale.trim().slice(0, 320)
        : base.rationale,
    targetEvidence: uniqueStrings(
      generated?.targetEvidence,
      base.targetEvidence,
      8,
    ),
    difficultyPriorities: Array.from(
      new Set(
        (generatedPriorities.length
          ? generatedPriorities
          : base.difficultyPriorities) as DifficultyDimension[],
      ),
    ).slice(0, 7),
    researchIntents: Array.from(byPurpose.values()).slice(0, 6),
  };
}

export function formatCourseStrategyForPrompt(
  strategy: CourseStrategy,
): string {
  const policy = strategyPolicies[strategy.mode];
  return [
    `策略模式：${policy.label}（${strategy.mode}）`,
    `决策理由：${strategy.rationale}`,
    `目标证据：${strategy.targetEvidence.join("；")}`,
    `优先难度维度：${strategy.difficultyPriorities.join("、")}`,
    "课堂约束：",
    ...policy.classroomContract.map((item, index) => `${index + 1}. ${item}`),
  ].join("\n");
}

export function formatTutorStrategyForPrompt(
  strategy: CourseStrategy,
): string {
  const policy = strategyPolicies[strategy.mode];
  return [
    `课程策略：${policy.label}（${strategy.mode}）`,
    `主要完成证据：${strategy.targetEvidence.join("；")}`,
    "助教约束：",
    ...policy.tutorContract.map((item, index) => `${index + 1}. ${item}`),
  ].join("\n");
}

export function buildLessonResearchQueries(input: {
  strategy: CourseStrategy;
  projectTitle: string;
  chapterTitle: string;
  section: LessonSection;
}): CourseResearchIntent[] {
  const base = `${input.projectTitle} ${input.chapterTitle} ${input.section.title}`;
  const purposesByMode: Record<
    CourseStrategyMode,
    CourseResearchIntent["purpose"][]
  > = {
    exam: ["tasks", "methods", "dependencies", "pitfalls"],
    work: ["scope", "tasks", "pitfalls", "evidence"],
    academic: ["dependencies", "methods", "evidence"],
    "quick-start": ["tasks", "pitfalls", "evidence"],
    mastery: ["dependencies", "methods", "pitfalls", "evidence"],
  };
  const courseIntentByPurpose = new Map(
    input.strategy.researchIntents.map((intent) => [
      intent.purpose,
      intent.query,
    ]),
  );
  return purposesByMode[input.strategy.mode].map((purpose) => ({
    purpose,
    query: `${base} ${
      courseIntentByPurpose.get(purpose) ??
      buildCourseResearchQuery(input.strategy.mode, purpose, base)
    }`
      .replace(/\s+/g, " ")
      .slice(0, 240),
  }));
}
