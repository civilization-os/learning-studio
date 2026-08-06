import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const providerPort = 18888;
const appPort = 18787;
const fallbackAppPort = 18786;
const restartAppPort = 18785;
const tempDir = await mkdtemp(join(tmpdir(), "learning-app-test-"));
const storePath = join(tempDir, "store.db");
const fallbackStorePath = join(tempDir, "fallback-store.db");
const jwtSecret = "web-search-smoke-test-jwt-secret";
const generatedCourseAnalysis = {
  courseType: "项目实战",
  targetOutcome: "能够完成并验证一个实时数据处理流程",
  priorKnowledge: "具备 Java 与 Spring 基础",
  depth: "standard",
  estimatedHours: 40,
  sessionMinutes: 45,
  assumptions: ["使用稳定版本进行学习"],
  strategy: {
    schemaVersion: 1,
    mode: "work",
    rationale: "用户希望解决实际问题，因此以真实任务、故障诊断和结果验收为主。",
    targetEvidence: [
      "能够交付可运行的数据处理任务",
      "能够解释状态与恢复机制",
      "能够定位故障并验证恢复结果",
    ],
    difficultyPriorities: ["concept", "diagnosis", "tradeoff", "transfer"],
    researchIntents: [
      { purpose: "scope", query: "Flink 官方文档 稳定版本 核心范围" },
      { purpose: "tasks", query: "Flink 生产实践 真实任务" },
      { purpose: "dependencies", query: "Flink 状态 恢复 前置依赖" },
      { purpose: "pitfalls", query: "Flink Checkpoint 故障案例" },
      { purpose: "evidence", query: "Flink 恢复 验收 可观测性" },
    ],
  },
  researchQueries: [
    "Flink Spring 集成 官方文档",
    "Flink 状态管理 Checkpoint 实践",
  ],
};
const generatedOutline = {
  audience: "具备基础计算机操作能力的初学者",
  courseGoal: "能够独立完成一个可部署的小型项目并进行测试与复盘",
  estimatedHours: 40,
  chapters: [
    {
      title: "建立基础认知",
      difficulty: 1,
      objective: "理解核心术语并搭建最小运行环境",
      prerequisites: [],
      estimatedHours: 5,
      sections: [
        { title: "认识核心术语", kind: "concept", outcome: "能够解释三个核心术语", estimatedMinutes: 45, practiceMinutes: 10, sourceRefs: [1] },
        { title: "认识核心术语", kind: "practice", outcome: "能够运行第一个示例", estimatedMinutes: 45, practiceMinutes: 30, sourceRefs: [1] },
        { title: "阶段小结", kind: "review", outcome: "能够识别常见配置错误", estimatedMinutes: 45, practiceMinutes: 20, sourceRefs: [2] },
      ],
    },
    {
      title: "掌握核心方法",
      difficulty: 3,
      objective: "使用核心方法解决结构化问题",
      prerequisites: ["核心术语", "运行环境"],
      estimatedHours: 7,
      sections: [
        { title: "拆解问题步骤", kind: "concept", outcome: "能够把目标拆成步骤", estimatedMinutes: 45, practiceMinutes: 15, sourceRefs: [1] },
        { title: "实现基础功能", kind: "practice", outcome: "能够完成基础功能", estimatedMinutes: 45, practiceMinutes: 30, sourceRefs: [2] },
        { title: "阶段小结", kind: "project", outcome: "能够交付可运行功能", estimatedMinutes: 60, practiceMinutes: 60, sourceRefs: [2] },
      ],
    },
    {
      title: "组织完整流程",
      difficulty: 3,
      objective: "把多个能力组合成稳定流程",
      prerequisites: ["基础功能实现"],
      estimatedHours: 8,
      sections: [
        { title: "设计模块边界", kind: "concept", outcome: "能够划分模块职责", estimatedMinutes: 45, practiceMinutes: 20, sourceRefs: [1] },
        { title: "组合多个模块", kind: "practice", outcome: "能够完成模块集成", estimatedMinutes: 60, practiceMinutes: 45, sourceRefs: [2] },
        { title: "阶段小结", kind: "project", outcome: "能够演示完整流程", estimatedMinutes: 60, practiceMinutes: 90, sourceRefs: [1, 2] },
      ],
    },
    {
      title: "处理复杂场景",
      difficulty: 4,
      objective: "诊断问题并改善可靠性",
      prerequisites: ["完整流程组织"],
      estimatedHours: 9,
      sections: [
        { title: "识别异常边界", kind: "concept", outcome: "能够列出异常场景", estimatedMinutes: 45, practiceMinutes: 20, sourceRefs: [1] },
        { title: "实施可靠性改进", kind: "practice", outcome: "能够修复关键缺陷", estimatedMinutes: 60, practiceMinutes: 45, sourceRefs: [2] },
        { title: "阶段小结", kind: "project", outcome: "能够通过异常测试", estimatedMinutes: 60, practiceMinutes: 90, sourceRefs: [1, 2] },
      ],
    },
    {
      title: "综合项目与验收",
      difficulty: 5,
      objective: "独立完成项目、验收并复盘",
      prerequisites: ["可靠性改进"],
      estimatedHours: 11,
      sections: [
        { title: "定义项目验收标准", kind: "concept", outcome: "能够编写验收清单", estimatedMinutes: 45, practiceMinutes: 20, sourceRefs: [1] },
        { title: "完成综合项目", kind: "project", outcome: "能够交付完整项目", estimatedMinutes: 90, practiceMinutes: 120, sourceRefs: [1, 2] },
        { title: "阶段小结", kind: "review", outcome: "能够形成改进计划", estimatedMinutes: 45, practiceMinutes: 30, sourceRefs: [2] },
      ],
    },
  ],
};

const incompleteOutline = {
  audience: "准备进行系统学习的用户",
  courseGoal: "完成课程目标",
  estimatedHours: 40,
  chapters: [
    {
      title: "基础认知",
      sections: [
        { title: "核心概念" },
        { title: "基本方法" },
      ],
    },
  ],
};

const generatedLessonContent = {
  learningDesign: {
    strategyMode: "work",
    whyNow: "状态与恢复是后续可靠性设计和故障排查的共同基础。",
    futureUses: ["Checkpoint 配置", "故障恢复", "一致性语义诊断"],
    successCriteria: [
      "能够解释状态快照和输入位置为何必须对齐",
      "能够从恢复现象定位错位问题",
    ],
    difficultyFocus: [
      "concept：区分可观测日志与可恢复状态",
      "diagnosis：从重复或丢失现象反推恢复错位",
    ],
    methodPaths: [
      {
        name: "一致性恢复路径",
        principle: "状态快照与输入位置描述同一个逻辑时刻。",
        bestFor: "需要故障恢复且保证处理一致性的流任务。",
        boundary: "外部系统副作用未参与一致性协议时仍需额外处理。",
      },
    ],
  },
  overview: "Build a reliable mental model before applying the skill.",
  scenes: [
    {
      type: "prediction",
      conceptKey: "state-recovery",
      navTitle: "先判断恢复起点",
      title: "Predict the first move",
      instruction: "Choose before reading the explanation.",
      body: "A small stream-processing job must survive a restart.",
      options: ["Ignore state", "Define state and recovery", "Only add logs"],
      answerIndex: 1,
      feedback: {
        correct: "Recovery requires explicit state and a recovery mechanism.",
        incorrect: "Logs alone do not restore the processing state.",
      },
      hints: [
        "Think about what disappears when the process restarts.",
        "Logs describe events but do not reconstruct in-memory state.",
      ],
      remediation:
        "Separate observability from recovery: logs help diagnose, while snapshots and input positions restore processing.",
      misconception: "Observability logs are being confused with recoverable state.",
      challenge:
        "What additional information must stay aligned with a state snapshot?",
      takeaway: "Start by identifying the state that must survive.",
    },
    {
      type: "concept",
      conceptKey: "state-recovery",
      navTitle: "连接状态与恢复",
      title: "Connect state with recovery",
      instruction: "Focus on the relationship rather than memorizing terms.",
      body: "State records what the job must remember; recovery rebuilds that memory after failure.",
      takeaway: "State and recovery solve different halves of reliability.",
    },
    {
      type: "step-reveal",
      conceptKey: "checkpoint-recovery",
      navTitle: "走一遍恢复过程",
      title: "Reveal the recovery path",
      instruction: "Open one step at a time and explain why it is needed.",
      body: "Trace one failure from detection to resumed processing.",
      steps: [
        "Persist a consistent snapshot so there is a trusted restore point.",
        "Detect failure and load the latest completed snapshot.",
        "Resume inputs from the matching position and verify the result.",
      ],
      takeaway: "A restore point and aligned input position must work together.",
    },
    {
      type: "error-diagnosis",
      conceptKey: "checkpoint-alignment",
      navTitle: "识别错位风险",
      title: "Diagnose a tempting shortcut",
      instruction: "Find the claim that breaks recovery correctness.",
      body: "A job can restore any state snapshot while consuming from the newest input position.",
      options: [
        "The snapshot and input position may not match",
        "Snapshots are always too slow",
        "There is no problem",
      ],
      answerIndex: 0,
      feedback: {
        correct: "The state and input position must describe the same logical moment.",
        incorrect: "Check whether restored state and resumed input still form one consistent history.",
      },
      hints: ["Compare the logical time represented by both pieces of data."],
      remediation:
        "Restore state and resume input from the same checkpoint boundary, otherwise data can be skipped or repeated.",
      misconception: "State snapshots and input positions are treated as independent.",
      challenge:
        "Describe one observable symptom caused by a mismatched input position.",
      takeaway: "Always verify that state and input progress are aligned.",
    },
  ],
  mindMap: {
    center: "Test lesson",
    branches: [
      { title: "Concept" },
      { title: "Method", details: ["Follow a repeatable process"] },
      { title: "Validation", details: ["Check the observable result"] },
    ],
  },
  explanation: {
    lead: "Start with the goal, then connect each step to an observable result.",
    paragraphs: [
      "The first paragraph explains the core idea in context.",
      "The second paragraph explains how to apply and verify it.",
    ],
    keyPoints: [
      "Understand the input",
      "Apply the method",
      "Verify the result",
    ],
  },
  example: {
    title: "A complete worked example",
    scenario: "Use the current lesson in a small realistic task.",
    steps: ["Prepare the required input", "Apply and inspect the result"],
    result: "The result satisfies the stated success criteria.",
    code: "console.log('lesson example');",
  },
  exercise: {
    question: "Which action best verifies the lesson result?",
    options: [
      "Ignore the output",
      "Compare it with success criteria",
      "Repeat without inspection",
      "Change the goal",
    ],
    answerIndex: 1,
    explanation: "The output must be compared with explicit success criteria.",
  },
};
const invalidSceneLessonContent = {
  ...generatedLessonContent,
  scenes: generatedLessonContent.scenes.slice(1),
};
const wrongStrategyLessonContent = {
  ...generatedLessonContent,
  learningDesign: {
    ...generatedLessonContent.learningDesign,
    strategyMode: "academic",
  },
};
const manualSectionId = "11111111-1111-4111-8111-111111111111";
const generatedPolishPatches = {
  nodes: [
    {
      id: manualSectionId,
      type: "section",
      title: "设计可验证的 Flink 状态练习",
      outcome: "能够说明状态读写过程，并通过检查点验证恢复结果",
    },
  ],
};
const generatedProjectDescription = {
  description:
    "围绕 Flink 在 Spring 项目中的集成方式，覆盖运行环境、数据流 API、时间与窗口、状态管理、Checkpoint 及常用连接器。内容按照核心概念、配置方法、典型场景和练习验证组织，使课程从基础机制逐步过渡到实时数据处理实践。",
};
const generatedPreferenceRecommendations = {
  learningGoal: "解决实际问题",
  currentLevel: null,
  coveragePreference: "标准覆盖",
  timeBudget: null,
  sessionLength: null,
};
let searchRequestCount = 0;
let outlineRepairRequestCount = 0;
let lessonRequestCount = 0;
let lastTutorSystemPrompt = "";
let lastLessonUserPrompt = "";

const providerServer = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.url === "/search") {
    searchRequestCount += 1;
    res.end(
      JSON.stringify({
        results: [
          {
            title: "可靠资料一",
            url: "https://example.edu/guide",
            content: "介绍核心概念、基础方法和循序渐进的学习路径。",
            score: 0.95,
          },
          {
            title: "可靠资料二",
            url: "https://example.org/practice",
            content: "提供实践任务、典型案例和复盘建议。",
            score: 0.88,
          },
        ],
      }),
    );
    return;
  }

  if (req.url === "/models") {
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          {
            id: "deepseek-official-test-model",
            object: "model",
            owned_by: "deepseek",
          },
        ],
      }),
    );
    return;
  }

  if (req.url === "/chat/completions") {
    let requestText = "";
    for await (const chunk of req) requestText += chunk;
    const requestBody = JSON.parse(requestText || "{}");
    const systemPrompt = String(requestBody.messages?.[0]?.content ?? "");
    const userPrompt = String(requestBody.messages?.[1]?.content ?? "");
    if (systemPrompt.includes("AI 助教")) {
      lastTutorSystemPrompt = systemPrompt;
    }
    if (systemPrompt.includes("课程内容生成 Agent")) {
      lastLessonUserPrompt = userPrompt;
      lessonRequestCount += 1;
    }
    const content = systemPrompt.includes("课程内容生成 Agent")
      ? JSON.stringify(
          lessonRequestCount === 1
            ? invalidSceneLessonContent
            : lessonRequestCount === 3
              ? wrongStrategyLessonContent
              : generatedLessonContent,
        )
      : systemPrompt.includes("AI 助教")
        ? "这是结合当前小节内容生成的助教回答。"
        : systemPrompt.includes("固定选项")
          ? JSON.stringify(generatedPreferenceRecommendations)
        : systemPrompt.includes("项目描述生成 Agent")
          ? JSON.stringify(generatedProjectDescription)
        : systemPrompt.includes("课程规划的第一步")
          ? JSON.stringify(generatedCourseAnalysis)
        : systemPrompt.includes("课程文案润色 Agent")
          ? JSON.stringify(generatedPolishPatches)
        : systemPrompt.includes("修复课程大纲的结构错误")
          ? (
              outlineRepairRequestCount += 1,
              JSON.stringify(generatedOutline)
            )
        : systemPrompt.includes("课程发布前检查")
          ? JSON.stringify(generatedOutline)
        : systemPrompt.includes("把课程范围编排成可学习的大纲")
          ? JSON.stringify(incompleteOutline)
        : JSON.stringify(generatedOutline);
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      }),
    );
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => providerServer.listen(providerPort, "127.0.0.1", resolve));

const appProcess = spawn("node", ["server/dist/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(appPort),
    APP_DB_PATH: storePath,
    JWT_SECRET: jwtSecret,
    NODE_ENV: "test",
    DEEPSEEK_API_KEY: "",
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${providerPort}`,
    TAVILY_API_KEY: "",
    TAVILY_API_URL: `http://127.0.0.1:${providerPort}/search`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let fallbackProcess;
let restartProcess;
let authToken = "";

async function request(path, init, port = appPort) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await request("/api/health");
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!ready) throw new Error("backend did not become ready");

  const codeDelivery = await request("/api/auth/send-code", {
    method: "POST",
    body: JSON.stringify({ email: "smoke@example.com" }),
  });
  if (!codeDelivery.devCode) throw new Error("expected a local test verification code");
  const registration = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: "smoke-user",
      password: "smoke-password-123",
      email: "smoke@example.com",
      code: codeDelivery.devCode,
      avatar: "🧪",
    }),
  });
  authToken = registration.token;

  const savedAiSettings = await request("/api/settings/ai", {
    method: "PUT",
    body: JSON.stringify({ apiKey: "deepseek-test-key" }),
  });
  if (!savedAiSettings.settings.apiKeyPersisted) {
    throw new Error("expected the DeepSeek key to be encrypted and persisted");
  }
  const savedSearchSettings = await request("/api/settings/search", {
    method: "PUT",
    body: JSON.stringify({ apiKey: "tavily-test-key" }),
  });
  if (!savedSearchSettings.settings.apiKeyPersisted) {
    throw new Error("expected the Tavily key to be encrypted and persisted");
  }

  const officialModels = await request("/api/models");
  if (officialModels.models[0]?.id !== "deepseek-official-test-model") {
    throw new Error("expected the official model list to be proxied");
  }
  await request("/api/settings/ai", {
    method: "PUT",
    body: JSON.stringify({ modelName: officialModels.models[0].id }),
  });

  const generatedDescription = await request(
    "/api/projects/generate-description",
    {
      method: "POST",
      body: JSON.stringify({ topic: "Flink 在 Spring 项目中的应用" }),
    },
  );
  if (
    !generatedDescription.description.includes("实时数据处理") ||
    searchRequestCount !== 0
  ) {
    throw new Error("expected an AI-generated description without web search");
  }

  const preferenceRecommendations = await request(
    "/api/projects/suggest-preferences",
    {
      method: "POST",
      body: JSON.stringify({
        topic: "Flink 在 Spring 项目中的应用",
        description: generatedDescription.description,
      }),
    },
  );
  if (
    preferenceRecommendations.recommendations.learningGoal !==
      "解决实际问题" ||
    preferenceRecommendations.recommendations.coveragePreference !==
      "标准覆盖" ||
    "currentLevel" in preferenceRecommendations.recommendations ||
    "timeBudget" in preferenceRecommendations.recommendations
  ) {
    throw new Error("expected only evidence-backed fixed preference options");
  }

  const created = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      title: "Web Search 学习测试",
      description: generatedDescription.description,
    }),
  });

  const generated = await request(
    `/api/projects/${encodeURIComponent(created.project.id)}/generate-outline`,
    {
      method: "POST",
      body: JSON.stringify({
        preferences: {
          learningGoal: "解决实际问题",
          coveragePreference: "标准覆盖",
        },
      }),
    },
  );

  if (generated.project.sources.length !== 2) {
    throw new Error("expected two persisted sources");
  }
  if (!generated.project.generation.webSearchUsed) {
    throw new Error("expected webSearchUsed to be true");
  }
  if (generated.project.generation.outlineStatus !== "draft") {
    throw new Error("expected an unaudited outline to be marked as draft");
  }
  if (generated.project.chapters.length !== 5) {
    throw new Error("expected generated chapters");
  }
  if (outlineRepairRequestCount !== 1) {
    throw new Error("expected one automatic outline repair request");
  }
  if (
    generated.project.chapters[0].sections[0].title ===
    generated.project.chapters[0].sections[1].title
  ) {
    throw new Error("expected duplicate sibling sections to be disambiguated");
  }
  const repeatedCrossChapterTitles = generated.project.chapters.filter(
    (chapter) =>
      chapter.sections.some((section) => section.title === "阶段小结"),
  );
  if (repeatedCrossChapterTitles.length !== generated.project.chapters.length) {
    throw new Error("expected repeated section titles across chapters to remain valid");
  }
  const difficulties = generated.project.chapters.map((chapter) => chapter.difficulty);
  if (difficulties.join(",") !== "1,3,3,4,5") {
    throw new Error("expected model-provided chapter difficulty to be preserved");
  }
  if (!generated.project.outlineSummary?.courseGoal) {
    throw new Error("expected persisted course blueprint");
  }
  if (
    generated.project.outlinePreferences?.coveragePreference !== "标准覆盖"
  ) {
    throw new Error("expected coverage preference to reach outline planning");
  }
  if (generated.project.chapters[0].sections[0].status !== "current") {
    throw new Error("expected first section to be current");
  }

  const generatedChapterCount = generated.project.chapters.length;
  const generatedFirstTitle = generated.project.chapters[0].title;
  const generatedAtBeforePolish = generated.project.generation.generatedAt;
  const noManualPolish = await request(
    `/api/projects/${encodeURIComponent(created.project.id)}/generate-outline`,
    {
      method: "POST",
      body: JSON.stringify({ mode: "optimize" }),
    },
  );
  if (
    noManualPolish.data.mode !== "polish" ||
    noManualPolish.data.polishedCount !== 0 ||
    !noManualPolish.data.warning
  ) {
    throw new Error("expected a no-manual-node polish warning");
  }

  const chaptersWithManualSection = structuredClone(generated.project.chapters);
  chaptersWithManualSection[0].sections.push({
    id: manualSectionId,
    title: "状态那个练习",
    status: "locked",
    origin: "user",
    kind: "practice",
    outcome: "把状态搞明白",
  });
  await request(
    `/api/projects/${encodeURIComponent(created.project.id)}/outline`,
    {
      method: "PUT",
      body: JSON.stringify({ chapters: chaptersWithManualSection }),
    },
  );

  const optimized = await request(
    `/api/projects/${encodeURIComponent(created.project.id)}/generate-outline`,
    {
      method: "POST",
      body: JSON.stringify({ mode: "optimize" }),
    },
  );
  if (optimized.data.mode !== "polish" || optimized.data.polishedCount !== 1) {
    throw new Error("expected one manually added node to be polished");
  }
  if (
    optimized.project.chapters.length !== generatedChapterCount ||
    optimized.project.chapters[0].title !== generatedFirstTitle
  ) {
    throw new Error("polishing must not restructure generated chapters");
  }
  const polishedSection = optimized.project.chapters[0].sections.find(
    (section) => section.id === manualSectionId,
  );
  if (
    polishedSection?.title !== "设计可验证的 Flink 状态练习" ||
    !polishedSection.outcome.includes("检查点")
  ) {
    throw new Error("expected the manual section language patch to be applied");
  }
  if (
    optimized.project.generation.generatedAt !== generatedAtBeforePolish ||
    optimized.project.sources.length !== 2 ||
    searchRequestCount !== generatedCourseAnalysis.strategy.researchIntents.length
  ) {
    throw new Error("polishing must preserve generation metadata and skip web search");
  }

  const lessonSection =
    optimized.project.chapters[0]?.sections[0];
  if (!lessonSection) throw new Error("expected a lesson section");
  const generatedLesson = await request(
    `/api/projects/${encodeURIComponent(created.project.id)}/sections/${encodeURIComponent(lessonSection.id)}/generate-content`,
    {
      method: "POST",
      body: JSON.stringify({ force: false }),
    },
  );
  if (generatedLesson.cached) {
    throw new Error("expected the first lesson generation not to be cached");
  }
  if (
    generatedLesson.content.exercise.answerIndex !== 1 ||
    generatedLesson.content.mindMap.branches.length !== 3 ||
    generatedLesson.content.scenes.length !== 4 ||
    generatedLesson.content.scenes[0].type !== "prediction" ||
    generatedLesson.content.scenes[0].conceptKey !== "state-recovery" ||
    generatedLesson.content.scenes[2].type !== "step-reveal" ||
    generatedLesson.content.mindMap.branches[0].details.length < 1 ||
    generatedLesson.content.learningDesign.strategyMode !== "work" ||
    generatedLesson.content.learningDesign.methodPaths[0].boundary.length < 1
  ) {
    throw new Error("expected structured generated lesson content");
  }
  if (lessonRequestCount !== 2) {
    throw new Error("expected invalid lesson scenes to trigger one repair request");
  }
  if (
    !lastLessonUserPrompt.includes("整门课程地图") ||
    !lastLessonUserPrompt.includes("工作与真实问题") ||
    lastLessonUserPrompt.includes("官方文档 当前版本 原理 最佳实践")
  ) {
    throw new Error("expected strategy-aware whole-course lesson generation");
  }

  const cachedLesson = await request(
    `/api/projects/${encodeURIComponent(created.project.id)}/sections/${encodeURIComponent(lessonSection.id)}/generate-content`,
    {
      method: "POST",
      body: JSON.stringify({ force: false }),
    },
  );
  if (!cachedLesson.cached) {
    throw new Error("expected generated lesson content to be cached");
  }

  const firstSceneId = generatedLesson.content.scenes[0].id;
  const secondSceneId = generatedLesson.content.scenes[1].id;
  const progressTimestamp = new Date().toISOString();
  const savedProgress = await request(
    `/api/projects/${encodeURIComponent(created.project.id)}/sections/${encodeURIComponent(lessonSection.id)}/progress`,
    {
      method: "PUT",
      body: JSON.stringify({
        progress: {
          schemaVersion: 1,
          currentSceneId: secondSceneId,
          completedSceneIds: [firstSceneId],
          evidence: {
            [firstSceneId]: {
              sceneId: firstSceneId,
              selectedIndex: 1,
              correct: true,
              attempts: 1,
              hintsUsed: 1,
              completed: true,
              firstTryCorrect: true,
              outcome: "mastered",
              route: "standard",
              updatedAt: progressTimestamp,
            },
          },
          knowledge: {
            "state-recovery": {
              conceptKey: "state-recovery",
              label: "先判断恢复起点",
              mastery: 0.88,
              evidenceCount: 1,
              correctCount: 1,
              attempts: 1,
              hintsUsed: 1,
              lastOutcome: "mastered",
              lastSeenAt: progressTimestamp,
              nextReviewAt: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
          },
          reflection: {
            summary: "先判断数据是否持续到达，再决定用流处理还是批处理。",
            confidence: "partial",
            tutorFeedback: "已经抓住判断条件，还可以补上延迟要求。",
            updatedAt: progressTimestamp,
          },
          updatedAt: progressTimestamp,
        },
      }),
    },
  );
  if (
    savedProgress.progress.currentSceneId !== secondSceneId ||
    savedProgress.project.chapters[0].sections[0].learningProgress
      ?.evidence[firstSceneId]?.hintsUsed !== 1 ||
    savedProgress.progress.knowledge?.["state-recovery"]?.mastery !== 0.88 ||
    savedProgress.progress.reflection?.confidence !== "partial"
  ) {
    throw new Error("expected scene learning evidence to be persisted");
  }

  const tutorAnswer = await request(
    `/api/projects/${encodeURIComponent(created.project.id)}/sections/${encodeURIComponent(lessonSection.id)}/tutor`,
    {
      method: "POST",
      body: JSON.stringify({
        message: "请再讲简单点",
        history: [],
        learningContext: {
          phase: "understand",
          attempt: "incorrect",
          confidence: null,
          scene: {
            sceneId: firstSceneId,
            selectedIndex: 0,
          },
        },
      }),
    },
  );
  if (!tutorAnswer.answer.includes("助教回答")) {
    throw new Error("expected a contextual tutor answer");
  }
  if (
    !lastTutorSystemPrompt.includes("Predict the first move") ||
    !lastTutorSystemPrompt.includes('"selectedOption":"Ignore state"') ||
    !lastTutorSystemPrompt.includes(
      '"correctOption":"Define state and recovery"',
    ) ||
    !lastTutorSystemPrompt.includes("工作与真实问题") ||
    !lastTutorSystemPrompt.includes("difficultyFocus")
  ) {
    throw new Error("expected tutor to receive the active scene and answer context");
  }

  const completedLesson = await request(
    `/api/projects/${encodeURIComponent(created.project.id)}/sections/${encodeURIComponent(lessonSection.id)}/complete`,
    { method: "POST" },
  );
  if (
    completedLesson.project.chapters[0].sections[0].status !== "done" ||
    completedLesson.project.progress <= 0 ||
    completedLesson.project.chapters[0].sections[0].learningProgress
      ?.currentSceneId !== secondSceneId
  ) {
    throw new Error("expected completed lesson progress to be persisted");
  }

  const repairedStrategyLesson = await request(
    `/api/projects/${encodeURIComponent(created.project.id)}/sections/${encodeURIComponent(lessonSection.id)}/generate-content`,
    {
      method: "POST",
      body: JSON.stringify({ force: true }),
    },
  );
  if (
    repairedStrategyLesson.content.learningDesign.strategyMode !== "work" ||
    lessonRequestCount !== 4
  ) {
    throw new Error("expected a mismatched lesson strategy to trigger repair");
  }

  const disposableProject = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      title: "待删除项目",
      description: "验证项目与学习记录可以一起删除",
    }),
  });
  const deletion = await request(
    `/api/projects/${encodeURIComponent(disposableProject.project.id)}`,
    { method: "DELETE" },
  );
  const projectsAfterDeletion = await request("/api/projects");
  if (
    !deletion.deleted ||
    projectsAfterDeletion.projects.some(
      (project) => project.id === disposableProject.project.id,
    )
  ) {
    throw new Error("expected the project to be removed from persistent storage");
  }

  const settingsDatabase = new Database(storePath, { readonly: true });
  const storedSettings = settingsDatabase
    .prepare("SELECT encrypted_secrets FROM user_settings LIMIT 1")
    .get();
  settingsDatabase.close();
  const serializedSecrets = storedSettings?.encrypted_secrets ?? "";
  if (serializedSecrets.includes("deepseek-test-key") || serializedSecrets.includes("tavily-test-key")) {
    throw new Error("API keys must not be persisted as plaintext");
  }
  const protectedSecrets = JSON.parse(serializedSecrets);
  if (
    protectedSecrets.deepSeekApiKey?.format !== "windows-dpapi-current-user-v1" ||
    protectedSecrets.tavilyApiKey?.format !== "windows-dpapi-current-user-v1"
  ) {
    throw new Error("expected a DPAPI-protected secrets record");
  }

  restartProcess = spawn("node", ["server/dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(restartAppPort),
      APP_DB_PATH: storePath,
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${providerPort}`,
      TAVILY_API_KEY: "",
      TAVILY_API_URL: `http://127.0.0.1:${providerPort}/search`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let restartReady = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await request("/api/health", undefined, restartAppPort);
      restartReady = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!restartReady) throw new Error("restarted backend did not become ready");

  const restoredAiSettings = await request(
    "/api/settings/ai",
    undefined,
    restartAppPort,
  );
  const restoredSearchSettings = await request(
    "/api/settings/search",
    undefined,
    restartAppPort,
  );
  if (
    !restoredAiSettings.settings.apiKeyConfigured ||
    !restoredAiSettings.settings.apiKeyPersisted
  ) {
    throw new Error("expected the DeepSeek key after process restart");
  }
  if (
    !restoredSearchSettings.settings.apiKeyConfigured ||
    !restoredSearchSettings.settings.apiKeyPersisted
  ) {
    throw new Error("expected the Tavily key after process restart");
  }
  const restoredModels = await request("/api/models", undefined, restartAppPort);
  if (restoredModels.models[0]?.id !== "deepseek-official-test-model") {
    throw new Error("expected the restored DeepSeek key to authorize model loading");
  }
  const restoredSearch = await request(
    "/api/search/test",
    { method: "POST" },
    restartAppPort,
  );
  if (!restoredSearch.webSearchUsed) {
    throw new Error("expected the restored Tavily key to authorize web search");
  }

  fallbackProcess = spawn("node", ["server/dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(fallbackAppPort),
      APP_DB_PATH: fallbackStorePath,
      JWT_SECRET: jwtSecret,
      NODE_ENV: "test",
      DEEPSEEK_API_KEY: "",
      TAVILY_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let fallbackReady = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await request("/api/health", undefined, fallbackAppPort);
      fallbackReady = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!fallbackReady) throw new Error("fallback backend did not become ready");

  const fallbackCodeDelivery = await request(
    "/api/auth/send-code",
    {
      method: "POST",
      body: JSON.stringify({ email: "fallback@example.com" }),
    },
    fallbackAppPort,
  );
  const fallbackRegistration = await request(
    "/api/auth/register",
    {
      method: "POST",
      body: JSON.stringify({
        username: "fallback-user",
        password: "fallback-password-123",
        email: "fallback@example.com",
        code: fallbackCodeDelivery.devCode,
        avatar: "🧪",
      }),
    },
    fallbackAppPort,
  );
  authToken = fallbackRegistration.token;

  const fallbackCreated = await request(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        title: "无密钥降级测试",
        description: "验证不消耗搜索额度",
      }),
    },
    fallbackAppPort,
  );
  const fallbackGenerated = await request(
    `/api/projects/${encodeURIComponent(fallbackCreated.project.id)}/generate-outline`,
    { method: "POST" },
    fallbackAppPort,
  );
  if (fallbackGenerated.project.generation.webSearchUsed) {
    throw new Error("fallback generation must not use web search");
  }
  if (fallbackGenerated.project.generation.outlineStatus !== "fallback") {
    throw new Error("expected fallback content to be marked explicitly");
  }
  if (!fallbackGenerated.project.generation.warning?.includes("跳过联网检索")) {
    throw new Error("expected a clear no-key fallback warning");
  }

  console.log("web-search outline smoke test passed");
} finally {
  await Promise.all([
    stopProcess(appProcess),
    stopProcess(fallbackProcess),
    stopProcess(restartProcess),
  ]);
  await new Promise((resolve) => providerServer.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}
