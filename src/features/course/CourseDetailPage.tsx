import { useState } from "react";
import { generateRemoteChapterToolLibrary } from "../../api";
import { ProgressRing } from "../../components/shared/ProgressRing";
import { useToast } from "../../components/ui/toast";
import type {
  ChapterToolLibrary,
  CourseChapter,
  LearningProject,
} from "../../studyAgent";
import { ChapterToolLibraryDrawer } from "./ChapterToolLibraryDrawer";

const sectionKindLabels = {
  concept: "概念",
  practice: "练习",
  project: "项目",
  review: "复盘",
};
const knowledgeRoleLabels = {
  foundation: "基础",
  tool: "工具",
  bridge: "桥梁",
  application: "应用",
  verification: "检验",
};

function getFirstCoursePosition(project: LearningProject) {
  for (const chapter of project.chapters) {
    const section =
      chapter.sections.find((item) => item.status === "current") ??
      chapter.sections[0];
    if (section) return { chapter, section };
  }
  return null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "发生未知错误";
}


export default function CourseDetailPage({
  project,
  onOpenSection,
  onEditOutline,
  onProjectUpdate,
  onBack,
}: {
  project: LearningProject;
  onOpenSection: (project: LearningProject, chapterId: string, sectionId: string) => void;
  onEditOutline: (project: LearningProject) => void;
  onProjectUpdate: (project: LearningProject) => void;
  onBack: () => void;
}) {
  const { notify } = useToast();
  const currentPosition = getFirstCoursePosition(project);
  const totalSections = project.chapters.reduce(
    (count, chapter) => count + chapter.sections.length,
    0,
  );
  const completedSections = project.chapters.reduce(
    (count, chapter) =>
      count + chapter.sections.filter((section) => section.status === "done").length,
    0,
  );
  const derivedProgress = totalSections
    ? Math.round((completedSections / totalSections) * 100)
    : 0;
  const displayProgress = Math.max(project.progress, derivedProgress);
  const estimatedHours =
    project.outlineSummary?.estimatedHours ??
    project.chapters.reduce(
      (total, chapter) => total + (chapter.estimatedHours ?? 0),
      0,
    );
  const currentSectionIndex = currentPosition
    ? project.chapters
        .flatMap((chapter) => chapter.sections)
        .findIndex((section) => section.id === currentPosition.section.id)
    : -1;
  const remainingSections = Math.max(
    0,
    totalSections - completedSections,
  );
  const isFirstSession =
    completedSections === 0 && project.weeklyMinutes === 0;
  const [openChapterIds, setOpenChapterIds] = useState<string[]>(() => {
    const currentChapterId = currentPosition?.chapter.id;
    return currentChapterId
      ? [currentChapterId]
      : project.chapters[0]
        ? [project.chapters[0].id]
        : [];
  });
  const [toolLibraryChapterId, setToolLibraryChapterId] = useState("");
  const [toolLibraryLoadingChapterId, setToolLibraryLoadingChapterId] =
    useState("");
  const selectedToolChapter = project.chapters.find(
    (chapter) => chapter.id === toolLibraryChapterId,
  );

  async function openChapterToolLibrary(
    chapter: CourseChapter,
    force = false,
  ) {
    if (chapter.toolLibrary && !force) {
      setToolLibraryChapterId(chapter.id);
      return;
    }
    if (toolLibraryLoadingChapterId) return;
    setToolLibraryChapterId(chapter.id);
    setToolLibraryLoadingChapterId(chapter.id);
    try {
      const result = await generateRemoteChapterToolLibrary(
        project.id,
        chapter.id,
        force,
      );
      onProjectUpdate(result.project);
      setToolLibraryChapterId(chapter.id);
      if (result.warning) {
        notify({
          variant: "warning",
          title: "本章工具已整理，部分资料未取得",
          description: result.warning,
        });
      }
    } catch (error) {
      setToolLibraryChapterId("");
      notify({
        variant: "error",
        title: "本章工具没有整理完成",
        description: getErrorMessage(error),
      });
    } finally {
      setToolLibraryLoadingChapterId("");
    }
  }

  return (
    <>
    <main className="page course-hub">
      <header className="course-hub-hero">
        <div className="course-hub-nav">
          <button className="icon-button" onClick={onBack} aria-label="返回首页">
            ←
          </button>
          <button
            className="course-outline-edit"
            onClick={() => onEditOutline(project)}
          >
            编辑课程路线
          </button>
        </div>

        <div className="course-hub-title">
          <span>学习项目</span>
          <h1>{project.title}</h1>
          <p>{project.description}</p>
          <div>
            <small>{project.chapters.length} 个阶段</small>
            <small>{totalSections} 堂课</small>
            {estimatedHours ? <small>约 {estimatedHours} 小时</small> : null}
            {project.sources?.length ? (
              <small>{project.sources.length} 项参考资料</small>
            ) : null}
          </div>
        </div>

        <div className="course-hub-progress">
          <ProgressRing value={displayProgress} tone={0} large />
          <div>
            <span>课程进度</span>
            <strong>
              {completedSections} / {totalSections} 堂课
            </strong>
            <small>
              {displayProgress
                ? `还有 ${remainingSections} 堂课`
                : "从第一堂课开始建立进度"}
            </small>
          </div>
        </div>
      </header>

      <section className="course-hub-status" aria-label="学习状态">
        <div>
          <span>现在</span>
          <strong>{isFirstSession ? "准备开始" : "继续推进"}</strong>
          <small>
            {currentPosition
              ? `第 ${currentSectionIndex + 1} / ${totalSections} 堂`
              : "尚未安排课堂"}
          </small>
        </div>
        <div>
          <span>本周投入</span>
          <strong>
            {project.weeklyMinutes
              ? `${project.weeklyMinutes} 分钟`
              : "尚未记录"}
          </strong>
          <small>
            {project.weeklyMinutes ? "来自本周课堂记录" : "完成课堂后自动统计"}
          </small>
        </div>
        <div>
          <span>学习反馈</span>
          <strong>
            {completedSections
              ? `${project.accuracy}% 正确率`
              : "等待第一份证据"}
          </strong>
          <small>
            {completedSections
              ? `${project.weakPoints.length} 个内容需要回看`
              : "练习与判断完成后出现"}
          </small>
        </div>
      </section>

      <div className="course-hub-layout">
        <section className="course-roadmap">
          <div className="course-hub-section-head">
            <div>
              <span>学习路线</span>
              <h2>从基础到能够独立完成</h2>
              <p>每一节都是一堂可以单独完成的课堂，随时从当前位置继续。</p>
            </div>
            <strong>{displayProgress}%</strong>
          </div>

          <div className="course-roadmap-list">
            {project.chapters.map((chapter, chapterIndex) => {
              const chapterCompleted = chapter.sections.filter(
                (section) => section.status === "done",
              ).length;
              const chapterProgress = chapter.sections.length
                ? Math.round(
                    (chapterCompleted / chapter.sections.length) * 100,
                  )
                : 0;
              const containsCurrent = chapter.sections.some(
                (section) => section.id === currentPosition?.section.id,
              );

              return (
                <details
                  className={
                    containsCurrent
                      ? "course-roadmap-chapter is-current"
                      : "course-roadmap-chapter"
                  }
                  key={chapter.id}
                  open={openChapterIds.includes(chapter.id)}
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setOpenChapterIds((current) => {
                      if (isOpen) {
                        return current.includes(chapter.id)
                          ? current
                          : [...current, chapter.id];
                      }
                      return current.filter((id) => id !== chapter.id);
                    });
                  }}
                >
                  <summary>
                    <span className="course-roadmap-index">
                      {String(chapterIndex + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <small>
                        {chapterCompleted}/{chapter.sections.length} 堂已完成
                      </small>
                      <h3>{chapter.title}</h3>
                      {chapter.objective ? <p>{chapter.objective}</p> : null}
                    </div>
                    <div className="course-roadmap-meta">
                      {chapter.estimatedHours ? (
                        <small>约 {chapter.estimatedHours} 小时</small>
                      ) : null}
                      <strong>{chapterProgress}%</strong>
                    </div>
                    <i aria-hidden="true">⌄</i>
                  </summary>

                  <div className="course-roadmap-sections">
                    <div className="course-roadmap-tools">
                      <div>
                        <small>本章工具</small>
                        <strong>
                          {chapter.toolLibrary
                            ? "随时查公式、方法和使用边界"
                            : "先根据整门课程和参考资料整理"}
                        </strong>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(toolLibraryLoadingChapterId)}
                        onClick={() => openChapterToolLibrary(chapter)}
                      >
                        {toolLibraryLoadingChapterId === chapter.id
                          ? "正在整理…"
                          : chapter.toolLibrary
                            ? "打开"
                            : "开始整理"}
                      </button>
                    </div>
                    {chapter.sections.map((section, sectionIndex) => (
                      <button
                        type="button"
                        key={section.id}
                        className={`course-roadmap-section course-roadmap-section--${section.status}`}
                        aria-current={
                          section.id === currentPosition?.section.id
                            ? "step"
                            : undefined
                        }
                        onClick={() =>
                          onOpenSection(project, chapter.id, section.id)
                        }
                      >
                        <span className="course-roadmap-section-status">
                          {section.status === "done"
                            ? "✓"
                            : `${chapterIndex + 1}.${sectionIndex + 1}`}
                        </span>
                        <div>
                          <small>
                            {section.kind
                              ? sectionKindLabels[section.kind]
                              : "课堂"}
                            {section.strategy?.role
                              ? ` · ${knowledgeRoleLabels[section.strategy.role]}`
                              : ""}
                            {section.estimatedMinutes
                              ? ` · ${section.estimatedMinutes} 分钟`
                              : ""}
                          </small>
                          <strong>{section.title}</strong>
                          {section.outcome ? <p>{section.outcome}</p> : null}
                        </div>
                        <span className="course-roadmap-section-action">
                          {section.status === "done"
                            ? "再看一次"
                            : section.id === currentPosition?.section.id
                              ? "继续"
                              : "开始"}
                          <i aria-hidden="true">→</i>
                        </span>
                      </button>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </section>

        <aside className="course-hub-sidebar">
          {currentPosition ? (
            <section className="course-next-card">
              <div className="course-next-label">
                <span />
                {isFirstSession ? "第一堂课" : "接下来"}
              </div>
              <small>{currentPosition.chapter.title}</small>
              <h2>{currentPosition.section.title}</h2>
              <p>
                {currentPosition.section.strategy?.whyNow ??
                  currentPosition.section.outcome ??
                  "完成本节后，你会获得下一步学习所需的基础。"}
              </p>
              <div className="course-next-meta">
                <span>
                  {currentPosition.section.estimatedMinutes
                    ? `${currentPosition.section.estimatedMinutes} 分钟`
                    : "一堂课"}
                </span>
                <span>
                  {currentPosition.section.kind
                    ? sectionKindLabels[currentPosition.section.kind]
                    : "学习"}
                </span>
                {currentPosition.section.strategy?.futureUses[0] ? (
                  <span>
                    后面用于：{currentPosition.section.strategy.futureUses[0]}
                  </span>
                ) : null}
              </div>
              <button
                className="primary-pill"
                onClick={() =>
                  onOpenSection(
                    project,
                    currentPosition.chapter.id,
                    currentPosition.section.id,
                  )
                }
              >
                {isFirstSession ? "开始第一堂课" : "继续学习"} →
              </button>
            </section>
          ) : (
            <section className="course-next-card is-empty">
              <div className="course-next-label">课程路线为空</div>
              <h2>先添加一堂课</h2>
              <p>编辑课程路线后，就能从这里开始学习。</p>
              <button
                className="primary-pill"
                onClick={() => onEditOutline(project)}
              >
                编辑课程路线
              </button>
            </section>
          )}

          <section className="course-hub-note">
            <span>这门课要解决</span>
            <p>
              {project.outlineSummary?.courseGoal ??
                project.outlinePlan?.targetOutcome ??
                project.description}
            </p>
            {project.outlinePlan ? (
              <div>
                <small>
                  {project.outlinePlan.depth === "intro"
                    ? "入门"
                    : project.outlinePlan.depth === "deep"
                      ? "深入"
                      : "标准深度"}
                </small>
                <small>每次约 {project.outlinePlan.sessionMinutes} 分钟</small>
              </div>
            ) : null}
          </section>

          {project.sources?.length ? (
            <details className="course-hub-sources">
              <summary>
                <span>
                  <small>课程依据</small>
                  <strong>{project.sources.length} 项参考资料</strong>
                </span>
                <i aria-hidden="true">＋</i>
              </summary>
              <div>
                {project.sources.slice(0, 5).map((source, index) => (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    key={`${source.url}-${index}`}
                  >
                    <span>{index + 1}</span>
                    <strong>{source.title}</strong>
                    <i aria-hidden="true">↗</i>
                  </a>
                ))}
              </div>
            </details>
          ) : null}
        </aside>
      </div>
    </main>
    <ChapterToolLibraryDrawer
      chapterTitle={selectedToolChapter?.title ?? ""}
      isLoading={
        Boolean(toolLibraryChapterId) &&
        toolLibraryLoadingChapterId === toolLibraryChapterId
      }
      isOpen={Boolean(toolLibraryChapterId)}
      library={selectedToolChapter?.toolLibrary}
      projectSources={project.sources ?? []}
      onClose={() => setToolLibraryChapterId("")}
      onRefresh={
        selectedToolChapter
          ? () => openChapterToolLibrary(selectedToolChapter, true)
          : undefined
      }
    />
    </>
  );
}

