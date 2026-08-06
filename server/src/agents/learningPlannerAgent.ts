import { LearningProject } from "../types.js";
import { AgentDefinition } from "./types.js";

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type KnowledgeAggregate = {
  conceptKey: string;
  label: string;
  mastery: number;
  lastOutcome: "mastered" | "supported" | "needs-review";
  nextReviewAt: string;
  intervalDays?: number;
  reviewCount?: number;
  misconception?: string;
};

type SectionReviewState = {
  projectId: string;
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  dueCount: number;
  weakestMastery: number;
  weakestLabel: string;
  items: KnowledgeAggregate[];
};

function buildSectionReviewStates(project: LearningProject) {
  const today = startOfToday();
  const states: SectionReviewState[] = [];
  for (const chapter of project.chapters) {
    for (const section of chapter.sections) {
      const knowledge = Object.values(
        section.learningProgress?.knowledge ?? {},
      );
      if (!knowledge.length) continue;
      const items = knowledge
        .map((item) => ({
          conceptKey: item.conceptKey,
          label: item.label,
          mastery: item.mastery,
          lastOutcome: item.lastOutcome,
          nextReviewAt: item.nextReviewAt,
          ...(item.intervalDays !== undefined
            ? { intervalDays: item.intervalDays }
            : {}),
          ...(item.reviewCount !== undefined
            ? { reviewCount: item.reviewCount }
            : {}),
          ...(item.misconception
            ? { misconception: item.misconception }
            : {}),
        }))
        .sort(
          (left, right) =>
            new Date(left.nextReviewAt).getTime() -
            new Date(right.nextReviewAt).getTime(),
        );
      const weakest = items.reduce<KnowledgeAggregate | undefined>(
        (current, item) =>
          !current || item.mastery < current.mastery ? item : current,
        undefined,
      );
      states.push({
        projectId: project.id,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        sectionId: section.id,
        sectionTitle: section.title,
        dueCount: items.filter(
          (item) => new Date(item.nextReviewAt) <= addDays(today, 1),
        ).length,
        weakestMastery: weakest?.mastery ?? 0,
        weakestLabel: weakest?.label ?? section.title,
        items,
      });
    }
  }
  return states;
}

export const learningPlannerAgent: AgentDefinition = {
  name: "learning-planner",
  displayName: "学习状态/复习规划 Agent",
  description: "根据各小节知识点掌握度与间隔重复排期，生成今日复习队列和统计建议。",
  async run(_input, context) {
    const project = context.project;
    if (!project) {
      throw new Error("课程项目不存在");
    }

    const today = startOfToday();
    const todayKey = formatDateKey(today);
    const states = buildSectionReviewStates(project);

    const dueToday = states
      .filter((state) => state.dueCount > 0)
      .sort(
        (left, right) =>
          left.weakestMastery - right.weakestMastery ||
          right.dueCount - left.dueCount,
      );

    const upcoming = states
      .filter((state) => state.dueCount === 0)
      .map((state) => ({
        sectionId: state.sectionId,
        chapterId: state.chapterId,
        chapterTitle: state.chapterTitle,
        sectionTitle: state.sectionTitle,
        weakestLabel: state.weakestLabel,
        nextReviewAt: state.items[0]?.nextReviewAt ?? null,
        nextReviewDate: state.items[0]
          ? formatDateKey(new Date(state.items[0].nextReviewAt))
          : null,
      }))
      .sort(
        (left, right) =>
          new Date(left.nextReviewAt ?? 0).getTime() -
          new Date(right.nextReviewAt ?? 0).getTime(),
      )
      .slice(0, 10);

    const totalKnowledge = states.reduce(
      (sum, state) => sum + state.items.length,
      0,
    );
    const totalDue = states.reduce((sum, state) => sum + state.dueCount, 0);
    const weakItems = states.flatMap((state) =>
      state.items
        .filter(
          (item) =>
            item.lastOutcome === "needs-review" ||
            item.mastery < 0.6,
        )
        .map((item) => ({
          sectionId: state.sectionId,
          sectionTitle: state.sectionTitle,
          conceptKey: item.conceptKey,
          label: item.label,
          mastery: item.mastery,
          misconception: item.misconception,
        })),
    );

    const todayPlan = dueToday.map((state) => ({
      sectionId: state.sectionId,
      chapterId: state.chapterId,
      chapterTitle: state.chapterTitle,
      sectionTitle: state.sectionTitle,
      dueCount: state.dueCount,
      weakestLabel: state.weakestLabel,
      weakestMastery: state.weakestMastery,
    }));

    const reviewPlan = dueToday.map((state) => ({
      date: todayKey,
      sectionId: state.sectionId,
      chapterId: state.chapterId,
      chapterTitle: state.chapterTitle,
      sectionTitle: state.sectionTitle,
      items: state.items,
    }));

    return {
      agent: "learning-planner",
      summary:
        totalDue > 0
          ? `今天有 ${dueToday.length} 个小节共 ${totalDue} 个知识点到期，建议优先复习。`
          : totalKnowledge > 0
            ? "今天没有到期的复习任务，可以继续学习新内容。"
            : "还没有学习记录，完成课堂作答后会自动生成复习计划。",
      data: {
        progress: project.progress ?? 0,
        accuracy: project.accuracy ?? 0,
        weakPoints: project.weakPoints ?? [],
        todayPlan,
        reviewPlan,
        dueTodayCount: dueToday.length,
        totalDue,
        totalKnowledge,
        upcoming,
        weakItems: weakItems.slice(0, 20),
      },
      nextActions:
        dueToday.length > 0
          ? ["开始今日复习", "查看薄弱点", "继续学习新内容"]
          : ["生成今日计划", "查看复习建议", "更新项目详情统计"],
    };
  },
};
