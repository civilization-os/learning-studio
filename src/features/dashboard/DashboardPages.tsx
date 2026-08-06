import { useMemo, useState, type CSSProperties } from "react";
import { useToast } from "../../components/ui/toast";
import { ProgressRing } from "../../components/shared/ProgressRing";
import type {
  LearningProject,
  LessonKnowledgeState,
} from "../../studyAgent";

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getScopedStorageKey(name: string) {
  const userId =
    typeof window !== "undefined" ? localStorage.getItem("app_user_id") : null;
  return userId ? `${name}:${userId}` : name;
}

function readCheckedInDates() {
  if (typeof window === "undefined") return [] as string[];
  try {
    const value = JSON.parse(
      localStorage.getItem(getScopedStorageKey("app_checked_in_dates")) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function calculateStreak(checkedInDates: string[]) {
  let count = 0;
  const checkSet = new Set(checkedInDates);
  const cursor = new Date();
  if (!checkSet.has(formatLocalDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (checkSet.has(formatLocalDateKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function getProjectLearningMetrics(project: LearningProject) {
  const sections = project.chapters.flatMap((chapter) =>
    chapter.sections.map((section) => ({ chapter, section })),
  );
  const evidence = sections.flatMap(({ section }) =>
    Object.values(section.learningProgress?.evidence ?? {}),
  );
  const answered = evidence.filter((item) => typeof item.correct === "boolean");
  const correct = answered.filter((item) => item.correct).length;
  return {
    sections,
    completedSections: sections.filter(({ section }) => section.status === "done").length,
    answeredCount: answered.length,
    masteredCount: evidence.filter((item) => item.outcome === "mastered").length,
    needsReviewCount:
      evidence.filter((item) => item.outcome === "needs-review").length +
      project.weakPoints.length,
    accuracy: answered.length ? Math.round((correct / answered.length) * 100) : null,
  };
}

function getFirstCoursePosition(project: LearningProject) {
  for (const chapter of project.chapters) {
    const section =
      chapter.sections.find((item) => item.status === "current") ??
      chapter.sections[0];
    if (section) return { chapter, section };
  }
  return null;
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StudyCalendarCard() {
  const { notify } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const todayKey = formatLocalDateKey(new Date());
  const [checkedInDates, setCheckedInDates] = useState<string[]>(readCheckedInDates);
  const streakCount = useMemo(
    () => calculateStreak(checkedInDates),
    [checkedInDates],
  );

  const isTodayCheckedIn = checkedInDates.includes(todayKey);

  const handleCheckIn = () => {
    if (isTodayCheckedIn) return;
    const nextDates = Array.from(new Set([todayKey, ...checkedInDates]));
    setCheckedInDates(nextDates);
    localStorage.setItem(
      getScopedStorageKey("app_checked_in_dates"),
      JSON.stringify(nextDates),
    );
    notify({
      variant: "success",
      title: "🎉 打卡成功！",
      description: `今日学习已打卡，已连续打卡 ${streakCount + 1} 天，保持专注继续加油！`,
    });
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed

  const monthNames = [
    "一月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "十一月", "十二月"
  ];

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDayOfMonth + 6) % 7;

  const todayDate = new Date().getDate();
  const todayMonth = new Date().getMonth();
  const todayYear = new Date().getFullYear();
  const isCurrentMonth = month === todayMonth && year === todayYear;

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  return (
    <section className="panel-card calendar-card" style={{ padding: "20px", borderRadius: "20px", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", marginTop: "0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
        <div>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-accent)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            学习打卡日历
          </span>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: "2px 0 0", color: "var(--color-text)" }}>
            {year}年 {monthNames[month]}
          </h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ padding: "4px 10px", borderRadius: "16px", background: "rgba(255, 149, 0, 0.12)", color: "#ff9500", fontWeight: 700, fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "4px" }}>
            🔥 {streakCount} 天打卡
          </span>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={prevMonth}
              type="button"
              aria-label="上个月"
              style={{ width: "30px", height: "30px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: "pointer", color: "var(--color-text)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem" }}
            >
              ‹
            </button>
            <button
              onClick={nextMonth}
              type="button"
              aria-label="下个月"
              style={{ width: "30px", height: "30px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: "pointer", color: "var(--color-text)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem" }}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* Weekday Header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px", textAlign: "center", fontWeight: 600, fontSize: "0.8rem", color: "var(--color-text-muted)", marginBottom: "8px" }}>
        {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px" }}>
        {Array.from({ length: startOffset }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const dayNum = i + 1;
          const isToday = isCurrentMonth && dayNum === todayDate;

          const dateObj = new Date(year, month, dayNum);
          const dateKey = formatLocalDateKey(dateObj);
          const isChecked = checkedInDates.includes(dateKey);
          const cellStyle: CSSProperties = {
            height: "36px",
            borderRadius: "10px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.85rem",
            fontWeight: isToday ? 700 : 500,
            position: "relative",
            background: isToday
              ? isChecked
                ? "#10b981"
                : "var(--color-accent)"
              : isChecked
                ? "rgba(16, 185, 129, 0.12)"
                : "var(--color-surface-subtle)",
            color: isToday
              ? "#ffffff"
              : isChecked
                ? "#10b981"
                : "var(--color-text)",
            border: isToday ? "none" : "1px solid var(--color-border-subtle)",
            cursor: isToday && !isChecked ? "pointer" : "default",
            transition: "background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease",
          };
          const cellContent = (
            <>
              <span>{dayNum}</span>
              {isChecked && !isToday ? (
                <span
                  aria-hidden="true"
                  style={{
                    width: "4px",
                    height: "4px",
                    borderRadius: "50%",
                    background: "#10b981",
                    marginTop: "2px",
                  }}
                />
              ) : null}
            </>
          );

          return isToday && !isChecked ? (
            <button
              key={dayNum}
              type="button"
              onClick={handleCheckIn}
              aria-label={`${year} 年 ${month + 1} 月 ${dayNum} 日，点击打卡`}
              style={cellStyle}
            >
              {cellContent}
            </button>
          ) : (
            <time
              key={dayNum}
              dateTime={dateKey}
              aria-label={`${year} 年 ${month + 1} 月 ${dayNum} 日${isChecked ? "，已打卡" : ""}`}
              style={cellStyle}
            >
              {cellContent}
            </time>
          );
        })}
      </div>

      {/* Check-In CTA Button */}
      <div style={{ marginTop: "16px" }}>
        <button
          type="button"
          disabled={isTodayCheckedIn}
          onClick={handleCheckIn}
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: "12px",
            border: "none",
            background: isTodayCheckedIn ? "rgba(16, 185, 129, 0.15)" : "var(--color-accent)",
            color: isTodayCheckedIn ? "#10b981" : "#ffffff",
            fontWeight: 700,
            fontSize: "0.9rem",
            cursor: isTodayCheckedIn ? "default" : "pointer",
            transition: "background-color 0.2s ease, color 0.2s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
        >
          {isTodayCheckedIn ? (
            <>
              <span>✓</span>
              <span>今日已完成打卡</span>
            </>
          ) : (
            <>
              <span>✦</span>
              <span>点击立即打卡</span>
            </>
          )}
        </button>
      </div>
    </section>
  );
}

export function HomePage({
  projects,
  onCreate,
  onOpenProject,
  onRequestDelete,
}: {
  projects: LearningProject[];
  onCreate: () => void;
  onOpenProject: (project: LearningProject) => void;
  onRequestDelete: (project: LearningProject) => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  return (
    <main className="page home-page">
      <section className="page-intro">
        <p>{greeting}，开启今天的学习之旅吧</p>
        <h1>我的学习项目</h1>
      </section>

      <div className="home-layout-container" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: "24px", alignItems: "start" }}>
        <section className="project-grid" style={{ marginTop: 0 }}>
          {projects.length === 0 && (
            <div className="empty-project-card">
              <span>＋</span>
              <h2>创建第一个学习项目</h2>
              <p>输入课题和内容描述后，系统会生成可调整的大纲，再进入课程详情和课程中心。</p>
              <button className="primary-pill" onClick={onCreate}>创建项目</button>
            </div>
          )}
          {projects.map((project, index) => (
            <article className="project-card project-card--managed" key={project.id}>
              <button
                className="project-card-main"
                onClick={() => onOpenProject(project)}
              >
                <ProgressRing value={project.progress} tone={index % 3} />
                <div className="project-copy">
                  <h2>{project.title}</h2>
                  <p>{project.description}</p>
                  <span>{project.lastStudied} · {project.pendingTasks} 项待完成</span>
                </div>
                <span className="round-play">▶</span>
              </button>
              <details className="project-card-menu">
                <summary aria-label={`管理项目：${project.title}`}>•••</summary>
                <div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      onRequestDelete(project);
                    }}
                  >
                    删除项目
                  </button>
                </div>
              </details>
            </article>
          ))}
          {projects.length > 0 && (
            <button className="create-card" onClick={onCreate}>
              <span>＋</span>
              <strong>创建新项目</strong>
            </button>
          )}
        </section>

        <aside className="home-sidebar" style={{ position: "sticky", top: "24px" }}>
          <StudyCalendarCard />
        </aside>
      </div>

      {projects.length > 0 && <button className="floating-create" onClick={onCreate} aria-label="创建项目">＋</button>}
    </main>
  );
}

export function EmptyProjectPage({ title, onCreate }: { title: string; onCreate: () => void }) {
  return (
    <main className="page empty-state-page">
      <section className="empty-project-card empty-project-card--page">
        <span>＋</span>
        <h1>{title}</h1>
        <p>先创建一个学习项目，系统会根据课题生成大纲。确认大纲后，计划、复习和统计会围绕项目自动展开。</p>
        <button className="primary-pill" onClick={onCreate}>创建项目</button>
      </section>
    </main>
  );
}

function EmptyCourseStructure({ projectTitle }: { projectTitle: string }) {
  return (
    <main className="page empty-state-page">
      <section className="empty-project-card empty-project-card--page">
        <span>!</span>
        <h1>{projectTitle} 暂无可学习内容</h1>
        <p>请返回项目大纲，至少添加一个章节和一个小节后再继续。</p>
      </section>
    </main>
  );
}

export function PlanPage({
  project,
  onOpenSection,
}: {
  project: LearningProject;
  onOpenSection: (project: LearningProject, chapterId: string, sectionId: string) => void;
}) {
  const tasks = project.chapters.flatMap((chapter) =>
    chapter.sections.map((section, index) => ({
      chapter,
      section,
      minutes: section.status === "done" ? 0 : 20 + index * 10,
      tag: section.status === "done" ? "已完成" : section.status === "current" ? "进行中" : "待开始",
    })),
  );
  const activeTasks = tasks.filter((task) => task.section.status !== "done");
  const firstTask = activeTasks[0] ?? tasks[0];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueSections = tasks
    .map(({ chapter, section }) => {
      const knowledge = Object.values(section.learningProgress?.knowledge ?? {});
      const dueKnowledge = knowledge.filter(
        (item) => new Date(item.nextReviewAt) <= today,
      );
      const weakest = dueKnowledge.reduce<LessonKnowledgeState | undefined>(
        (current, item) =>
          !current || item.mastery < current.mastery ? item : current,
        undefined,
      );
      return { chapter, section, dueCount: dueKnowledge.length, weakest };
    })
    .filter((item) => item.dueCount > 0)
    .sort(
      (left, right) =>
        (left.weakest?.mastery ?? 0) - (right.weakest?.mastery ?? 0),
    );

  return (
    <main className="page plan-page">
      <section className="page-intro">
        <p>{project.title}</p>
        <h1>今天的学习节奏</h1>
      </section>

      <section className="plan-layout">
        <div className="plan-summary-card">
          <ProgressRing value={Math.min(100, Math.max(0, project.progress))} tone={1} large />
          <div>
            <p>今日计划</p>
            <h2>{activeTasks.length} 项任务待推进</h2>
            <span>
              {dueSections.length
                ? `另有 ${dueSections.length} 个小节有知识点到期，建议先复习。`
                : "建议先完成当前小节，再处理复习和练习。"}
            </span>
          </div>
          <button
            className="primary-pill"
            disabled={!firstTask}
            onClick={() => firstTask && onOpenSection(project, firstTask.chapter.id, firstTask.section.id)}
          >
            开始今日任务
          </button>
        </div>

        <div className="week-strip" aria-label="本周日期">
          {["周一", "周二", "今天", "周四", "周五", "周六", "周日"].map((day) => (
            <span className={day === "今天" ? "active" : ""} aria-current={day === "今天" ? "date" : undefined} key={day}>{day}</span>
          ))}
        </div>

        {dueSections.length ? (
          <section className="task-list-card review-due-card">
            <div className="panel-title">
              <p>间隔重复</p>
              <h2>今日到期复习</h2>
            </div>
            {dueSections.slice(0, 5).map(({ chapter, section, dueCount, weakest }) => (
              <button
                className="task-row task-row--review"
                key={section.id}
                onClick={() => onOpenSection(project, chapter.id, section.id)}
              >
                <i />
                <div>
                  <strong>{section.title}</strong>
                  <span>
                    {chapter.title} · {weakest?.label ?? "薄弱知识点"}
                    {dueCount > 1 ? ` 等 ${dueCount} 项` : ""}
                  </span>
                </div>
                <small>复习</small>
              </button>
            ))}
          </section>
        ) : null}

        <section className="task-list-card">
          <div className="panel-title">
            <p>今日任务</p>
            <h2>按章节推进</h2>
          </div>
          {tasks.slice(0, 6).map((task) => (
            <button
              className={`task-row task-row--${task.section.status}`}
              key={task.section.id}
              disabled={task.section.status === "locked"}
              onClick={() => {
                if (task.section.status !== "locked") {
                  onOpenSection(project, task.chapter.id, task.section.id);
                }
              }}
            >
              <i />
              <div>
                <strong>{task.section.title}</strong>
                <span>{task.chapter.title} · {task.minutes || 15} 分钟</span>
              </div>
              <small>{task.tag}</small>
            </button>
          ))}
        </section>
      </section>
    </main>
  );
}

export function ReviewPage({
  project,
  onOpenSection,
}: {
  project: LearningProject;
  onOpenSection: (project: LearningProject, chapterId: string, sectionId: string) => void;
}) {
  const metrics = getProjectLearningMetrics(project);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reviewableSections = metrics.sections
    .map(({ chapter, section }) => {
      const knowledge = Object.values(section.learningProgress?.knowledge ?? {});
      const dueKnowledge = knowledge.filter(
        (item) => new Date(item.nextReviewAt) <= today,
      );
      const weakest = dueKnowledge.reduce<LessonKnowledgeState | undefined>(
        (current, item) =>
          !current || item.mastery < current.mastery ? item : current,
        undefined,
      );
      const hasLegacyReview =
        section.status === "done" ||
        Object.values(section.learningProgress?.evidence ?? {}).some(
          (item) => item.outcome === "needs-review",
        );
      if (!dueKnowledge.length && !hasLegacyReview) return null;
      return {
        chapter,
        section,
        dueCount: dueKnowledge.length,
        weakest,
        hasLegacyReview,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => {
      if (left.dueCount && !right.dueCount) return -1;
      if (!left.dueCount && right.dueCount) return 1;
      const leftDate = left.weakest?.nextReviewAt ?? "";
      const rightDate = right.weakest?.nextReviewAt ?? "";
      return leftDate.localeCompare(rightDate);
    });
  const currentPosition = reviewableSections[0] ?? getFirstCoursePosition(project);

  if (!currentPosition) {
    return <EmptyCourseStructure projectTitle={project.title} />;
  }

  const { chapter: currentChapter, section: currentSection } = currentPosition;
  const reviewCount = Math.max(
    reviewableSections.reduce((sum, item) => sum + item.dueCount, 0),
    metrics.needsReviewCount,
  );

  return (
    <main className="page review-page">
      <section className="page-intro">
        <p>{project.title}</p>
        <h1>今天轻松回顾</h1>
      </section>

      <section className="review-grid">
        <div className="review-start-card">
          <div className="review-orb">
            <span>{reviewCount}</span>
            <small>待复习</small>
          </div>
          <h2>先处理薄弱点，再进入新内容</h2>
          <p>建议从「{reviewableSections[0]?.weakest?.label ?? currentSection.title}」开始，结合已有作答记录快速回顾。</p>
          <button className="primary-pill" onClick={() => onOpenSection(project, currentChapter.id, currentSection.id)}>
            开始复习
          </button>
        </div>

        <div className="review-stats">
          <StatusCard label="待复习内容" value={`${reviewCount} 个`} />
          <StatusCard label="已掌握证据" value={`${metrics.masteredCount} 条`} />
          <StatusCard label="累计作答" value={`${metrics.answeredCount} 次`} />
        </div>

        <section className="review-type-grid">
          {reviewableSections.slice(0, 6).map(({ chapter, section, dueCount, weakest }) => (
            <button
              className="review-type-card"
              key={section.id}
              onClick={() => onOpenSection(project, chapter.id, section.id)}
            >
              <span aria-hidden="true">↻</span>
              <strong>{section.title}</strong>
              <small>
                {chapter.title}
                {weakest
                  ? ` · ${weakest.label}${dueCount > 1 ? ` 等 ${dueCount} 项` : ""}`
                  : " · 带薄弱点完成"}
              </small>
            </button>
          ))}
          {!reviewableSections.length ? (
            <p className="review-empty-note">
              完成课堂或留下作答记录后，需要回顾的内容会出现在这里。
            </p>
          ) : null}
        </section>
      </section>
    </main>
  );
}

export function StatsPage({ projects, activeProject }: { projects: LearningProject[]; activeProject: LearningProject }) {
  const averageProgress = Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / Math.max(1, projects.length));
  const totalMinutes = projects.reduce((sum, project) => sum + project.weeklyMinutes, 0);
  const projectMetrics = projects.map(getProjectLearningMetrics);
  const totalCompletedTasks = projectMetrics.reduce(
    (sum, metrics) => sum + metrics.completedSections,
    0,
  );
  const answeredProjects = projectMetrics.filter(
    (metrics) => metrics.accuracy !== null,
  );
  const averageAccuracy = answeredProjects.length
    ? Math.round(
        answeredProjects.reduce(
          (sum, metrics) => sum + (metrics.accuracy ?? 0),
          0,
        ) / answeredProjects.length,
      )
    : null;
  const checkedInDates = readCheckedInDates();
  const checkedInSet = new Set(checkedInDates);
  const streakCount = calculateStreak(checkedInDates);
  const recentDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return {
      key: formatLocalDateKey(date),
      label: new Intl.DateTimeFormat("zh-CN", { weekday: "short" })
        .format(date)
        .replace("周", ""),
    };
  });
  const activeMetrics = getProjectLearningMetrics(activeProject);

  return (
    <main className="page stats-page">
      <section className="page-intro">
        <p>学习足迹</p>
        <h1>本周学习统计</h1>
      </section>

      <section className="stats-layout">
        <div className="stats-hero-card">
          <ProgressRing value={averageProgress} tone={0} large />
          <div>
            <p>整体完成率</p>
            <h2>{averageProgress}%</h2>
            <span>基于当前 {projects.length} 个学习项目综合计算。</span>
          </div>
        </div>

        <section className="status-grid">
          <StatusCard label="累计学习" value={`${totalMinutes} 分钟`} />
          <StatusCard label="连续学习" value={`${streakCount} 天`} />
          <StatusCard label="完成任务" value={`${totalCompletedTasks} 项`} />
          <StatusCard label="平均正确率" value={averageAccuracy === null ? "暂无作答" : `${averageAccuracy}%`} />
        </section>

        <div className="stats-bottom-grid">
          <section className="bubble-card">
            <div className="panel-title">
              <p>学科分布</p>
              <h2>投入占比</h2>
            </div>
            <div className="subject-bubbles">
              {projects.slice(0, 8).map((project, index) => (
                <span className={`subject-bubble subject-bubble--${index % 3}`} key={project.id} style={{ width: 88 + Math.round(project.progress * 0.55), height: 88 + Math.round(project.progress * 0.55) }}>
                  {project.title.slice(0, 4)}
                  <small>{project.progress}%</small>
                </span>
              ))}
              {projects.length > 8 ? <small>另有 {projects.length - 8} 个项目</small> : null}
            </div>
          </section>

          <section className="trend-card">
            <div className="panel-title">
              <p>近 7 天</p>
              <h2>学习连续性</h2>
            </div>
            <div className="day-dots">
              {recentDays.map((day) => (
                <span key={day.key} style={{ height: checkedInSet.has(day.key) ? 82 : 20 }}>
                  <i />
                  <small>{day.label}</small>
                </span>
              ))}
            </div>
            <p className="stats-trend-note">
              当前项目已有 {activeMetrics.answeredCount} 次作答记录。
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
