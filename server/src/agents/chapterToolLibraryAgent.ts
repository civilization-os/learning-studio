import { callDeepSeek } from "../deepseek.js";
import {
  ChapterToolBasis,
  ChapterToolCategory,
  ChapterToolItem,
  ChapterToolLibrary,
  ChapterToolPlacement,
  CourseChapter,
  LearningProject,
  WebSource,
} from "../types.js";
import { searchWeb } from "../webSearch.js";
import { AgentDefinition } from "./types.js";

type CoverageArea = {
  id: string;
  label: string;
  purpose: string;
  questions: string[];
  sectionIds: string[];
};

type CoveragePlan = {
  scope: string;
  areas: CoverageArea[];
  researchQueries: Array<{
    purpose: "scope" | "structure" | "methods" | "tasks" | "dependencies" | "pitfalls";
    query: string;
  }>;
};

type GeneratedToolSet = {
  title?: unknown;
  scope?: unknown;
  items?: unknown;
};

type ResearchBundle = {
  sources: WebSource[];
  webSearchUsed: boolean;
  warning?: string;
};

const toolCategories = new Set<ChapterToolCategory>([
  "concept",
  "formula",
  "method",
  "decision",
  "procedure",
  "checklist",
  "pattern",
  "reference",
]);
const toolPlacements = new Set<ChapterToolPlacement>([
  "chapter-core",
  "chapter-support",
  "later-bridge",
]);
const toolBases = new Set<ChapterToolBasis>([
  "course-scope",
  "reference-structure",
  "section-outcome",
  "downstream-dependency",
]);
const researchPurposes = new Set([
  "scope",
  "structure",
  "methods",
  "tasks",
  "dependencies",
  "pitfalls",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function requireText(value: unknown, field: string, maxLength = 1200) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`模型返回的${field}不完整`);
  }
  return value.trim().slice(0, maxLength);
}

function textList(
  value: unknown,
  options: {
    maxItems: number;
    maxLength?: number;
    allowed?: Set<string>;
  },
) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(
          (item) =>
            Boolean(item) && (!options.allowed || options.allowed.has(item)),
        )
        .map((item) => item.slice(0, options.maxLength ?? 320)),
    ),
  ).slice(0, options.maxItems);
}

function extractJsonObject<T>(content: string): T {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("模型没有返回有效 JSON");
  }
  return JSON.parse(content.slice(start, end + 1)) as T;
}

async function callJsonWithRepair<T>(params: {
  settings: Parameters<typeof callDeepSeek>[0];
  prompt: string;
  repairLabel: string;
  temperature?: number;
}): Promise<T> {
  const response = await callDeepSeek(
    params.settings,
    [
      {
        role: "system",
        content:
          "你负责整理可实际查用的课程内容。严格依据输入范围工作，只输出有效 JSON，不写自我评价、覆盖率或工作过程。",
      },
      { role: "user", content: params.prompt },
    ],
    {
      responseFormat: "json_object",
      temperature: params.temperature ?? 0.12,
    },
  );

  try {
    return extractJsonObject<T>(response.content);
  } catch (error) {
    const repair = await callDeepSeek(
      params.settings,
      [
        {
          role: "system",
          content:
            "修复下面的 JSON。不得删掉有效内容，不得新增输入之外的事实，只输出一个完整 JSON 对象。",
        },
        {
          role: "user",
          content: `${params.repairLabel}

解析错误：${error instanceof Error ? error.message : "JSON 无效"}

待修复内容：
${response.content.slice(0, 60_000)}`,
        },
      ],
      { responseFormat: "json_object", temperature: 0.02 },
    );
    return extractJsonObject<T>(repair.content);
  }
}

function courseMap(project: LearningProject) {
  return project.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    objective: chapter.objective,
    sections: chapter.sections.map((section) => ({
      id: section.id,
      title: section.title,
      kind: section.kind,
      outcome: section.outcome,
      role: section.strategy?.role,
      futureUses: section.strategy?.futureUses,
    })),
  }));
}

function getDownstreamSections(
  project: LearningProject,
  chapter: CourseChapter,
) {
  const chapterIndex = project.chapters.findIndex(
    (item) => item.id === chapter.id,
  );
  if (chapterIndex < 0) return [];
  return project.chapters.slice(chapterIndex).flatMap((item, offset) => {
    const start = offset === 0 ? item.sections.length : 0;
    return item.sections.slice(start).map((section) => ({
      chapterId: item.id,
      chapterTitle: item.title,
      sectionId: section.id,
      sectionTitle: section.title,
      outcome: section.outcome,
      futureUses: section.strategy?.futureUses ?? [],
    }));
  });
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createChapterToolLibraryFingerprint(
  project: LearningProject,
  chapterId: string,
) {
  return stableHash(
    JSON.stringify({
      title: project.title,
      description: project.description,
      goal:
        project.outlineSummary?.courseGoal ??
        project.outlinePlan?.targetOutcome ??
        "",
      mode: project.outlinePlan?.strategy?.mode ?? "",
      chapterId,
      chapters: courseMap(project),
    }),
  );
}

function parseCoveragePlan(
  value: unknown,
  validSectionIds: Set<string>,
): CoveragePlan {
  const input = asRecord(value);
  const rawAreas = Array.isArray(input.areas) ? input.areas : [];
  const areas = rawAreas
    .map(asRecord)
    .flatMap((area, index) => {
      const label =
        typeof area.label === "string" ? area.label.trim().slice(0, 100) : "";
      const purpose =
        typeof area.purpose === "string"
          ? area.purpose.trim().slice(0, 260)
          : "";
      const questions = textList(area.questions, {
        maxItems: 8,
        maxLength: 240,
      });
      if (!label || !purpose || !questions.length) return [];
      const sectionIds = textList(area.sectionIds, {
        maxItems: 30,
        maxLength: 160,
      }).filter((id) => validSectionIds.has(id));
      return [
        {
          id:
            typeof area.id === "string" && area.id.trim()
              ? area.id.trim().slice(0, 80)
              : `area-${index + 1}`,
          label,
          purpose,
          questions,
          sectionIds,
        },
      ];
    })
    .slice(0, 18);
  const rawQueries = Array.isArray(input.researchQueries)
    ? input.researchQueries
    : [];
  const researchQueries = rawQueries
    .map(asRecord)
    .flatMap((query) => {
      if (
        typeof query.purpose !== "string" ||
        !researchPurposes.has(query.purpose) ||
        typeof query.query !== "string" ||
        !query.query.trim()
      ) {
        return [];
      }
      return [
        {
          purpose: query.purpose as CoveragePlan["researchQueries"][number]["purpose"],
          query: query.query.trim().slice(0, 260),
        },
      ];
    })
    .slice(0, 10);
  if (areas.length < 4 || researchQueries.length < 3) {
    throw new Error("工具范围规划不完整");
  }
  return {
    scope: requireText(input.scope, "工具范围", 500),
    areas,
    researchQueries,
  };
}

function buildBaselineQueries(
  project: LearningProject,
  chapter: CourseChapter,
  downstream: ReturnType<typeof getDownstreamSections>,
) {
  const mode = project.outlinePlan?.strategy?.mode ?? "mastery";
  const downstreamTitles = downstream
    .slice(0, 8)
    .map((item) => item.sectionTitle)
    .join("、");
  const queries = [
    `${project.title} ${chapter.title} 教学大纲 教材目录 知识结构`,
    `${chapter.title} 核心概念 公式 定理 方法 适用条件`,
    `${chapter.title} 常用工具 判断步骤 易错点 边界条件`,
    downstreamTitles
      ? `${chapter.title} 到 ${downstreamTitles} 前置知识 依赖 方法`
      : `${chapter.title} 后续课程 前置知识 依赖 方法`,
  ];
  if (mode === "exam") {
    queries.push(`${project.title} ${chapter.title} 考试题型 识别方法 简便解法`);
  } else if (mode === "work") {
    queries.push(`${project.title} ${chapter.title} 官方文档 最佳实践 排错`);
  } else {
    queries.push(`${project.title} ${chapter.title} 典型问题 方法选择`);
  }
  return queries;
}

export function buildChapterToolResearchQueries(
  project: LearningProject,
  chapterId: string,
) {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) return [];
  return buildBaselineQueries(
    project,
    chapter,
    getDownstreamSections(project, chapter),
  );
}

function uniqueQueries(
  plan: CoveragePlan,
  baseline: string[],
) {
  const seen = new Set<string>();
  return [...baseline, ...plan.researchQueries.map((item) => item.query)]
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter((query) => {
      const key = query.toLocaleLowerCase();
      if (!query || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function mergeSources(groups: WebSource[][], existing: WebSource[]) {
  const byUrl = new Map<string, WebSource>();
  for (const source of [...groups.flat(), ...existing]) {
    const current = byUrl.get(source.url);
    if (!current || (source.score ?? 0) > (current.score ?? 0)) {
      byUrl.set(source.url, source);
    }
  }
  return Array.from(byUrl.values())
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, 30);
}

async function researchTools(params: {
  queries: string[];
  project: LearningProject;
  context: Parameters<AgentDefinition["run"]>[1];
}): Promise<ResearchBundle> {
  const results: Awaited<ReturnType<typeof searchWeb>>[] = [];
  const errors: string[] = [];
  const batchSize = 3;
  for (let start = 0; start < params.queries.length; start += batchSize) {
    const batch = params.queries.slice(start, start + batchSize);
    const settled = await Promise.all(
      batch.map(async (query) => {
        try {
          return await searchWeb(
            params.context.store.webSearchSettings,
            query,
            { maxResults: 5, searchDepth: "advanced" },
          );
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "资料搜索失败");
          return {
            sources: [],
            webSearchUsed: false,
            warning: "部分资料搜索没有完成。",
          };
        }
      }),
    );
    results.push(...settled);
    params.context.reportProgress?.({
      stage: "正在查找本章所需资料",
      detail: `已完成 ${Math.min(start + batch.length, params.queries.length)} / ${params.queries.length} 组检索`,
      progress:
        24 +
        Math.round(
          (Math.min(start + batch.length, params.queries.length) /
            Math.max(1, params.queries.length)) *
            22,
        ),
      completedUnits: Math.min(start + batch.length, params.queries.length),
      totalUnits: params.queries.length,
    });
  }
  const warnings = [
    ...results.map((result) => result.warning).filter(Boolean),
    ...errors,
  ];
  return {
    sources: mergeSources(
      results.map((result) => result.sources),
      params.project.sources ?? [],
    ),
    webSearchUsed: results.some((result) => result.webSearchUsed),
    ...(warnings.length
      ? { warning: Array.from(new Set(warnings)).join("；").slice(0, 500) }
      : {}),
  };
}

function formatSources(sources: WebSource[]) {
  if (!sources.length) return "本次未取得外部资料；不得伪造来源编号。";
  return sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.title}
URL: ${source.url}
摘要: ${source.snippet.slice(0, 700)}`,
    )
    .join("\n\n");
}

function parseSourceIndexes(value: unknown, sources: WebSource[]) {
  if (!Array.isArray(value)) return [];
  const urls = value.flatMap((item) => {
    const index =
      typeof item === "number"
        ? item
        : typeof item === "string" && /^\d+$/.test(item.trim())
          ? Number(item)
          : NaN;
    return Number.isInteger(index) && index >= 1 && index <= sources.length
      ? [sources[index - 1].url]
      : [];
  });
  return Array.from(new Set(urls)).slice(0, 12);
}

function normaliseToolItems(params: {
  value: unknown;
  chapter: CourseChapter;
  validSectionIds: Set<string>;
  sources: WebSource[];
  minItems?: number;
}) {
  if (!Array.isArray(params.value)) {
    throw new Error("模型返回的工具条目不完整");
  }
  const chapterSectionIds = new Set(
    params.chapter.sections.map((section) => section.id),
  );
  const seen = new Set<string>();
  const items: ChapterToolItem[] = [];

  for (const rawValue of params.value) {
    const raw = asRecord(rawValue);
    const title = requireText(raw.title, "工具名称", 120);
    const titleKey = title
      .toLocaleLowerCase()
      .replace(/[\s，,。；;：:（）()《》"'“”‘’]/g, "");
    if (!titleKey || seen.has(titleKey)) continue;
    if (
      typeof raw.category !== "string" ||
      !toolCategories.has(raw.category as ChapterToolCategory) ||
      typeof raw.placement !== "string" ||
      !toolPlacements.has(raw.placement as ChapterToolPlacement)
    ) {
      throw new Error(`工具“${title}”的分类或位置无效`);
    }
    const content = textList(raw.content, {
      maxItems: 16,
      maxLength: 420,
    });
    if (!content.length) {
      throw new Error(`工具“${title}”没有可查用的实际内容`);
    }
    const relatedSectionIds = textList(raw.relatedSectionIds, {
      maxItems: 40,
      maxLength: 160,
    }).filter(
      (id) => params.validSectionIds.has(id) && chapterSectionIds.has(id),
    );
    const usedInSectionIds = textList(raw.usedInSectionIds, {
      maxItems: 50,
      maxLength: 160,
    }).filter((id) => params.validSectionIds.has(id));
    const introducedInSectionId =
      typeof raw.introducedInSectionId === "string" &&
      params.validSectionIds.has(raw.introducedInSectionId)
        ? raw.introducedInSectionId
        : undefined;
    const sourceRefs = parseSourceIndexes(raw.sourceIndexes, params.sources);
    const basis = textList(raw.basis, {
      maxItems: 4,
      maxLength: 80,
      allowed: toolBases as Set<string>,
    }) as ChapterToolBasis[];
    if (sourceRefs.length && !basis.includes("reference-structure")) {
      basis.push("reference-structure");
    }
    if (usedInSectionIds.length && !basis.includes("downstream-dependency")) {
      basis.push("downstream-dependency");
    }
    if (!basis.length) basis.push("course-scope");
    seen.add(titleKey);
    items.push({
      id: `tool-${params.chapter.id}-${stableHash(titleKey)}`,
      title,
      category: raw.category as ChapterToolCategory,
      placement: raw.placement as ChapterToolPlacement,
      summary: requireText(raw.summary, `工具“${title}”的说明`, 320),
      content,
      useWhen: requireText(raw.useWhen, `工具“${title}”的使用时机`, 420),
      boundary: requireText(raw.boundary, `工具“${title}”的使用边界`, 520),
      ...(introducedInSectionId ? { introducedInSectionId } : {}),
      relatedSectionIds,
      usedInSectionIds,
      sourceRefs,
      basis: Array.from(new Set(basis)),
    });
  }
  if (items.length < (params.minItems ?? 4)) {
    throw new Error("工具条目过少，无法形成可用的本章工具库");
  }
  if (items.length > 120) {
    throw new Error("工具条目异常，需缩小重复内容后重试");
  }
  return items;
}

function parseToolSet(params: {
  value: unknown;
  chapter: CourseChapter;
  validSectionIds: Set<string>;
  sources: WebSource[];
  minItems?: number;
}) {
  const input = asRecord(params.value) as GeneratedToolSet;
  return {
    title: requireText(input.title, "工具库标题", 120),
    scope: requireText(input.scope, "工具库范围", 600),
    items: normaliseToolItems({
      value: input.items,
      chapter: params.chapter,
      validSectionIds: params.validSectionIds,
      sources: params.sources,
      minItems: params.minItems,
    }),
  };
}

function toolJsonSchema() {
  return `{
  "title":"具体的本章工具库名称",
  "scope":"只说明整理范围，不声称绝对完整",
  "items":[
    {
      "title":"工具名称",
      "category":"concept|formula|method|decision|procedure|checklist|pattern|reference",
      "placement":"chapter-core|chapter-support|later-bridge",
      "summary":"这项工具解决什么问题",
      "content":["可直接查用的定义、公式、步骤、命令或检查项"],
      "useWhen":"遇到什么信号或任务时使用",
      "boundary":"使用条件、不能使用的情况和容易混淆处",
      "introducedInSectionId":"正式展开它的小节 ID；不能判断时省略",
      "relatedSectionIds":["本章中直接相关的小节 ID"],
      "usedInSectionIds":["本章后面或后续章节会调用它的小节 ID"],
      "sourceIndexes":[1],
      "basis":["course-scope|reference-structure|section-outcome|downstream-dependency"]
    }
  ]
}`;
}

async function parseToolSetWithRepair(params: {
  value: unknown;
  chapter: CourseChapter;
  validSectionIds: Set<string>;
  sources: WebSource[];
  settings: Parameters<typeof callDeepSeek>[0];
  label: string;
  minItems?: number;
}) {
  try {
    return parseToolSet(params);
  } catch (error) {
    const repairPrompt = `下面是一份已经生成的本章工具清单，但结构校验没有通过。只修复结构和缺失字段，不缩减已有的有效工具，不新增输入之外的事实。

校验错误：${error instanceof Error ? error.message : "结构不完整"}

章节：
${JSON.stringify({
  id: params.chapter.id,
  title: params.chapter.title,
  sections: params.chapter.sections.map((section) => ({
    id: section.id,
    title: section.title,
    outcome: section.outcome,
  })),
})}

可用参考资料：
${formatSources(params.sources)}

可用于 usedInSectionIds 的课程小节 ID：
${JSON.stringify(Array.from(params.validSectionIds))}

原始清单：
${JSON.stringify(params.value).slice(0, 60_000)}

必须按以下结构返回：
${toolJsonSchema()}

要求：
1. 每项都要有实际 content、使用时机和边界；
2. introducedInSectionId 和 relatedSectionIds 只能使用本章小节 ID；usedInSectionIds 可以使用列出的课程小节 ID；
3. sourceIndexes 只能引用上面的资料编号；
4. 不输出修复说明、完整度数字或自我评价。`;
    const repaired = await callJsonWithRepair<Record<string, unknown>>({
      settings: params.settings,
      prompt: repairPrompt,
      repairLabel: `修复${params.label} JSON，必须保留 title、scope、items。`,
      temperature: 0.02,
    });
    return parseToolSet({
      value: repaired,
      chapter: params.chapter,
      validSectionIds: params.validSectionIds,
      sources: params.sources,
      minItems: params.minItems,
    });
  }
}

async function planCoverage(params: {
  project: LearningProject;
  chapter: CourseChapter;
  validSectionIds: Set<string>;
  settings: Parameters<typeof callDeepSeek>[0];
}) {
  const prompt = `为下面这一章制定“工具整理范围”，暂时不要编写最终工具内容。

课程：${params.project.title}
课程目标：${
    params.project.outlineSummary?.courseGoal ??
    params.project.outlinePlan?.targetOutcome ??
    params.project.description
  }
学习方向：${params.project.outlinePlan?.strategy?.mode ?? "系统掌握"}
目标章节：${params.chapter.title}
章节目标：${params.chapter.objective ?? "未单独说明"}
章节小节：
${JSON.stringify(
  params.chapter.sections.map((section) => ({
    id: section.id,
    title: section.title,
    outcome: section.outcome,
    futureUses: section.strategy?.futureUses,
  })),
)}

整门课程：
${JSON.stringify(courseMap(params.project))}

只输出：
{
  "scope":"本章工具整理到哪里",
  "areas":[
    {
      "id":"稳定的英文或拼音短标识",
      "label":"真实的内容类别名称",
      "purpose":"为什么需要检查这一类",
      "questions":["整理时必须回答的问题"],
      "sectionIds":["相关小节 ID"]
    }
  ],
  "researchQueries":[
    {
      "purpose":"scope|structure|methods|tasks|dependencies|pitfalls",
      "query":"可直接执行的具体搜索词"
    }
  ]
}

要求：
1. areas 必须从本课程和本章推导，不使用“其他知识”等空类别；
2. 必须覆盖概念对象、公式或规则、变换与推导、方法选择、操作步骤、条件边界、反例易错、后续依赖；若某类不适用于本学科，用对应的真实类别替换；
3. researchQueries 至少分别核对教材或文档结构、常用方法、任务或题型、后续依赖；
4. 不预设某个具体学科工具，不根据常识硬塞名称；
5. 不输出覆盖率、数量目标或自我评价。`;
  const raw = await callJsonWithRepair<Record<string, unknown>>({
    settings: params.settings,
    prompt,
    repairLabel: "修复工具范围规划 JSON，保留 scope、areas、researchQueries。",
    temperature: 0.08,
  });
  return parseCoveragePlan(raw, params.validSectionIds);
}

async function createInventory(params: {
  project: LearningProject;
  chapter: CourseChapter;
  plan: CoveragePlan;
  areas: CoverageArea[];
  sources: WebSource[];
  settings: Parameters<typeof callDeepSeek>[0];
}) {
  const prompt = `根据课程位置、整理范围和参考资料，编写这一章的工具候选清单。

课程目标：${
    params.project.outlineSummary?.courseGoal ??
    params.project.outlinePlan?.targetOutcome ??
    params.project.description
  }
学习方向：${params.project.outlinePlan?.strategy?.mode ?? "系统掌握"}
目标章节：
${JSON.stringify({
  id: params.chapter.id,
  title: params.chapter.title,
  objective: params.chapter.objective,
  prerequisites: params.chapter.prerequisites,
  sections: params.chapter.sections,
})}

整门课程位置：
${JSON.stringify(courseMap(params.project))}

整体整理范围：
${params.plan.scope}

当前批次必须逐项处理：
${JSON.stringify(params.areas)}

参考资料：
${formatSources(params.sources)}

按以下结构输出：
${toolJsonSchema()}

要求：
1. 工具不是小节摘要，而是学习者以后会反复调用、查找或用于判断的内容；
2. 数量由真实范围决定，不凑固定数量，也不得因为内容多而只保留最显眼的几项；
3. 当前批次中的每个整理类别都要逐项检查，但没有实际工具时不要虚构；
4. chapter-core 是本章正式学习的工具；chapter-support 是本章会调用的前置或辅助工具；later-bridge 是现在应知道其存在、后续才正式展开的工具；
5. 必须把后续小节会反复调用、但初学者通常不知道要找的工具登记出来；placement 标为 later-bridge，不要求现在掌握；
6. sourceIndexes 只能引用上面的资料编号；资料未支持的内容不得伪造编号；
7. 公式、命令和规则必须写出实际内容，不得只有名称；
8. 不输出“已完整覆盖”、覆盖率、审查过程或建议性空话。`;
  const raw = await callJsonWithRepair<Record<string, unknown>>({
    settings: params.settings,
    prompt,
    repairLabel: "修复工具候选清单 JSON，必须保留 title、scope、items。",
    temperature: 0.12,
  });
  return raw;
}

function mergeInventoryParts(
  chapter: CourseChapter,
  plan: CoveragePlan,
  parts: Array<ReturnType<typeof parseToolSet>>,
) {
  const byId = new Map<string, ChapterToolItem>();
  for (const part of parts) {
    for (const item of part.items) {
      const current = byId.get(item.id);
      if (!current || item.content.join("").length > current.content.join("").length) {
        byId.set(item.id, item);
      }
    }
  }
  const items = Array.from(byId.values());
  if (items.length < 4) {
    throw new Error("分批整理后仍没有形成可用的本章工具库");
  }
  return {
    title: `${chapter.title}工具`,
    scope: plan.scope,
    items,
  };
}

async function reviewInventory(params: {
  project: LearningProject;
  chapter: CourseChapter;
  plan: CoveragePlan;
  inventory: ReturnType<typeof parseToolSet>;
  sources: WebSource[];
  downstream: ReturnType<typeof getDownstreamSections>;
  settings: Parameters<typeof callDeepSeek>[0];
}) {
  const sourceIndexByUrl = new Map(
    params.sources.map((source, index) => [source.url, index + 1]),
  );
  const serialisedInventory = {
    ...params.inventory,
    items: params.inventory.items.map((item) => ({
      ...item,
      sourceIndexes: item.sourceRefs.flatMap((url) => {
        const index = sourceIndexByUrl.get(url);
        return index ? [index] : [];
      }),
      sourceRefs: undefined,
      id: undefined,
    })),
  };
  const prompt = `检查并整理下面的本章工具候选清单，直接返回修订后的最终清单。

课程：${params.project.title}
学习方向：${params.project.outlinePlan?.strategy?.mode ?? "系统掌握"}
本章：${params.chapter.title}
本章小节：${JSON.stringify(params.chapter.sections)}

后续课程节点：
${JSON.stringify(params.downstream)}

原定整理范围：
${JSON.stringify(params.plan)}

候选清单：
${JSON.stringify(serialisedInventory)}

参考资料：
${formatSources(params.sources)}

按以下结构输出：
${toolJsonSchema()}

必须依次检查：
1. 范围中的每类问题是否都有对应的真实工具，不能只检查候选清单已有内容；
2. 参考资料中的目录、方法、公式、规则或任务结构是否出现了候选清单遗漏；
3. 遍历每个后续课程节点，判断完成它是否需要本章提供工具；遗漏项加入 usedInSectionIds 和 downstream-dependency；
4. 删除同义重复、把过大的综合项拆成可查用条目、补齐只有名称没有内容的空项；
5. 检查每项的使用时机和边界，不能把“常用”“按需使用”等空话当说明；
6. 后续才正式学习的内容保留为 later-bridge，不能伪装成本章已经讲完；
7. 不为了显得丰富加入与本章范围无关的高级内容；
8. 不输出完整度数字、自我评价、检查说明或待核实条目；无法确认的内容不要进入最终清单。`;
  return callJsonWithRepair<Record<string, unknown>>({
    settings: params.settings,
    prompt,
    repairLabel: "修复最终工具库 JSON，必须保留 title、scope、items。",
    temperature: 0.05,
  });
}

export const chapterToolLibraryAgent: AgentDefinition = {
  name: "chapter-tool-library",
  displayName: "本章工具整理",
  description:
    "根据课程范围、参考资料和后续章节依赖，整理可反复查用的章级工具。",
  async run(input, context) {
    const project = context.project;
    if (!project) throw new Error("课程项目不存在");
    const chapterId =
      typeof input.chapterId === "string" ? input.chapterId : "";
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("课程章节不存在");
    const validSectionIds = new Set(
      project.chapters.flatMap((item) =>
        item.sections.map((section) => section.id),
      ),
    );
    const downstream = getDownstreamSections(project, chapter);

    context.reportProgress?.({
      stage: "正在确定本章需要哪些工具",
      detail: "先看本章范围、学习目标和整门课程的位置",
      progress: 8,
    });
    const plan = await planCoverage({
      project,
      chapter,
      validSectionIds,
      settings: context.store.aiSettings,
    });

    const queries = uniqueQueries(
      plan,
      buildChapterToolResearchQueries(project, chapter.id),
    );
    context.reportProgress?.({
      stage: "正在查找本章所需资料",
      detail: "分别核对课程结构、常用方法、任务类型和后续依赖",
      progress: 22,
      completedUnits: 0,
      totalUnits: queries.length,
    });
    const research = await researchTools({
      queries,
      project,
      context,
    });

    const areaBatches: CoverageArea[][] = [];
    for (let index = 0; index < plan.areas.length; index += 3) {
      areaBatches.push(plan.areas.slice(index, index + 3));
    }
    const inventoryParts: Array<ReturnType<typeof parseToolSet>> = [];
    for (let index = 0; index < areaBatches.length; index += 1) {
      const areas = areaBatches[index];
      context.reportProgress?.({
        stage: "正在整理可反复使用的内容",
        detail: `正在处理：${areas.map((area) => area.label).join("、")}`,
        progress: 48 + Math.round((index / Math.max(1, areaBatches.length)) * 20),
        completedUnits: index,
        totalUnits: areaBatches.length,
      });
      const inventoryRaw = await createInventory({
        project,
        chapter,
        plan,
        areas,
        sources: research.sources,
        settings: context.store.aiSettings,
      });
      inventoryParts.push(
        await parseToolSetWithRepair({
          value: inventoryRaw,
          chapter,
          validSectionIds,
          sources: research.sources,
          settings: context.store.aiSettings,
          label: `第 ${index + 1} 批工具候选清单`,
          minItems: 1,
        }),
      );
    }
    const inventory = mergeInventoryParts(chapter, plan, inventoryParts);

    context.reportProgress?.({
      stage: "正在从后面的课程反查遗漏",
      detail: downstream.length
        ? `逐项检查 ${downstream.length} 个后续课堂会调用哪些本章工具`
        : "检查本章各小节之间的调用关系",
      progress: 72,
      completedUnits: 0,
      totalUnits: Math.max(1, downstream.length),
    });
    const reviewedRaw = await reviewInventory({
      project,
      chapter,
      plan,
      inventory,
      sources: research.sources,
      downstream,
      settings: context.store.aiSettings,
    });
    const reviewed = await parseToolSetWithRepair({
      value: reviewedRaw,
      chapter,
      validSectionIds,
      sources: research.sources,
      settings: context.store.aiSettings,
      label: "最终工具库",
    });

    context.reportProgress?.({
      stage: "正在合并重复内容",
      detail: "保留可直接查用的内容，并确认正式学习和后续使用的位置",
      progress: 92,
      completedUnits: Math.max(1, downstream.length),
      totalUnits: Math.max(1, downstream.length),
    });
    const sourceRefs = Array.from(
      new Set(reviewed.items.flatMap((item) => item.sourceRefs)),
    );
    const toolLibrary: ChapterToolLibrary = {
      schemaVersion: 1,
      chapterId: chapter.id,
      title: reviewed.title,
      scope: reviewed.scope,
      generatedAt: new Date().toISOString(),
      modelName: context.store.aiSettings.modelName,
      outlineFingerprint: createChapterToolLibraryFingerprint(
        project,
        chapter.id,
      ),
      sourceRefs,
      items: reviewed.items,
      generation: {
        webSearchUsed: research.webSearchUsed,
        researchQueries: queries,
        coverageAreas: plan.areas.map((area) => area.label),
        passes: [
          "scope",
          "research",
          "inventory",
          "dependencies",
          "review",
        ],
        ...(research.warning ? { warning: research.warning } : {}),
      },
    };

    return {
      agent: "chapter-tool-library",
      summary: "本章工具已经按课程位置和后续用途整理完成。",
      data: {
        toolLibrary,
        sources: research.sources,
        sourceRefs,
        webSearchUsed: research.webSearchUsed,
        ...(research.warning ? { warning: research.warning } : {}),
      },
      nextActions: ["从本节正在使用的工具开始", "需要时查看本章工具"],
    };
  },
};
