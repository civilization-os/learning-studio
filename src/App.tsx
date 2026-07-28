import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  askRemoteTutor,
  completeRemoteSection,
  createRemoteProject,
  deleteRemoteProject,
  generateRemoteLesson,
  generateRemoteOutline,
  generateRemoteProjectDescription,
  getRemotePreferenceRecommendations,
  getRemoteAiSettings,
  getRemoteModels,
  getRemoteSearchSettings,
  saveRemoteLessonProgress,
  saveRemoteOutline,
  subscribeGenerationTasks,
  testRemoteAiConnection,
  testRemoteSearchConnection,
  updateRemoteAiSettings,
  updateRemoteSearchSettings,
  type RemoteModel,
  type GenerationTask,
  type TutorHistoryItem,
  type TutorSceneContext,
} from "./api";
import { useToast } from "./components/ui/toast";
import {
  CourseChapter,
  createProjectFromGoal,
  LessonContent,
  LessonKnowledgeState,
  LessonProgress,
  LessonScene,
  LessonSceneEvidence,
  LessonSection,
  LearningProject,
  ModelSettings,
  OutlinePreferences,
  PreferenceRecommendations,
  StudyState,
} from "./studyAgent";
import { preferenceQuestions } from "./preferenceConfig";
import { loadStudyState, saveStudyState } from "./storage";

type MainView = "home" | "plan" | "review" | "stats";
type AppView = MainView | "create" | "generating" | "outline" | "detail" | "classroom" | "settings";

const navItems: Array<{ view: MainView; label: string; icon: string }> = [
  { view: "home", label: "首页", icon: "⌂" },
  { view: "plan", label: "计划", icon: "◷" },
  { view: "review", label: "复习", icon: "↻" },
  { view: "stats", label: "统计", icon: "◎" },
];

const difficultyLabels = ["", "入门", "基础", "进阶", "高级", "综合"];
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function isUserAddedOutlineNode(node: {
  id: string;
  origin?: "ai" | "user";
}) {
  return node.origin === "user" || (!node.origin && uuidPattern.test(node.id));
}

function getFirstCoursePosition(project: LearningProject) {
  for (const chapter of project.chapters) {
    const section = chapter.sections.find((item) => item.status === "current") ?? chapter.sections[0];
    if (section) return { chapter, section };
  }
  return null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "发生未知错误";
}

function getSourceHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "参考资料";
  }
}

export default function App() {
  const { notify } = useToast();
  const [state, setState] = useState<StudyState>(() => loadStudyState());
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([]);
  const [view, setView] = useState<AppView>("home");
  const [draftProject, setDraftProject] = useState<LearningProject | null>(null);
  const [outlineReturnView, setOutlineReturnView] = useState<"create" | "detail">(
    "create",
  );
  const [projectPendingDeletion, setProjectPendingDeletion] =
    useState<LearningProject | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  useEffect(() => {
    saveStudyState(state);
  }, [state]);

  useEffect(() => subscribeGenerationTasks(setGenerationTasks), []);

  useEffect(() => {
    if (!projectPendingDeletion) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDeletingProject) {
        setProjectPendingDeletion(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isDeletingProject, projectPendingDeletion]);

  const activeProject = useMemo(
    () => state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0] ?? null,
    [state.activeProjectId, state.projects],
  );

  const activeChapter = activeProject?.chapters.find((chapter) => chapter.id === state.activeChapterId) ?? activeProject?.chapters[0] ?? null;
  const activeSection = activeChapter?.sections.find((section) => section.id === state.activeSectionId) ?? activeChapter?.sections[0] ?? null;

  function go(next: AppView) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectProject(project: LearningProject) {
    const firstPosition = getFirstCoursePosition(project);
    setState((current) => ({
      ...current,
      activeProjectId: project.id,
      activeChapterId: firstPosition?.chapter.id ?? "",
      activeSectionId: firstPosition?.section.id ?? "",
    }));
    go("detail");
  }

  async function startCreate(
    topic: string,
    description: string,
    preferences: OutlinePreferences,
  ) {
    setOutlineReturnView("create");
    go("generating");
    let project: LearningProject;

    try {
      project = {
        ...(await createRemoteProject({ topic, description })),
        outlinePreferences: preferences,
      };
      try {
        const generated = await generateRemoteOutline(
          project.id,
          "generate",
          preferences,
        );
        project = generated.project;
        if (project.generation?.outlineStatus === "fallback") {
          notify({
            variant: "error",
            title: "课程结构没有生成完成",
            description:
              generated.data.warning ??
              "当前显示的是临时内容，请在大纲页重新规划课程。",
          });
        } else if (generated.data.warning) {
          notify({
            variant: "warning",
            title: generated.data.webSearchUsed ? "大纲已生成" : "已使用降级模式",
            description: generated.data.warning,
          });
        }
      } catch (error) {
        notify({
          variant: "error",
          title: "联网大纲生成失败",
          description: `已保留基础大纲：${getErrorMessage(error)}`,
        });
      }
    } catch (error) {
      project = {
        ...createProjectFromGoal({ topic, description }),
        outlinePreferences: preferences,
      };
      notify({
        variant: "warning",
        title: "已切换到本地模式",
        description: `后端暂不可用：${getErrorMessage(error)}`,
      });
    }

    setDraftProject(project);
    go("outline");
  }

  function updateDraftChapters(chapters: CourseChapter[]) {
    setDraftProject((project) => (project ? { ...project, chapters } : project));
  }

  function editProjectOutline(project: LearningProject) {
    setDraftProject(project);
    setOutlineReturnView("detail");
    go("outline");
  }

  async function regenerateDraftOutline() {
    if (!draftProject) return;

    try {
      const generated = await generateRemoteOutline(
        draftProject.id,
        "generate",
        draftProject.outlinePreferences,
      );
      setDraftProject(generated.project);

      const isFallback =
        generated.project.generation?.outlineStatus === "fallback";
      const chapterCount = generated.project.chapters.length;
      const sectionCount = generated.project.chapters.reduce(
        (count, chapter) => count + chapter.sections.length,
        0,
      );

      notify({
        variant: isFallback
          ? "error"
          : generated.data.warning
            ? "warning"
            : "success",
        title: isFallback
          ? "课程结构仍未生成完成"
          : "课程已重新规划",
        description:
          generated.data.warning ??
          `已整理为 ${chapterCount} 章、${sectionCount} 个小节。`,
      });
    } catch (error) {
      notify({
        variant: "error",
        title: "重新规划失败",
        description: getErrorMessage(error),
      });
    }
  }

  async function optimizeDraftOutline() {
    if (!draftProject) return;
    try {
      await saveRemoteOutline(draftProject.id, draftProject.chapters);
      const generated = await generateRemoteOutline(draftProject.id, "optimize");
      setDraftProject(generated.project);
      const polishedCount = generated.data.polishedCount ?? 0;
      notify({
        variant: generated.data.warning ? "warning" : "success",
        title: generated.data.warning ? "新增节点尚未润色" : "新增节点润色完成",
        description:
          generated.data.warning ??
          `已改善 ${polishedCount} 个手动新增节点的标题和学习描述，其他大纲内容保持不变。`,
      });
    } catch (error) {
      notify({
        variant: "error",
        title: "新增内容润色失败",
        description: getErrorMessage(error),
      });
    }
  }

  async function finishOutline() {
    if (!draftProject) return;
    const chapter = draftProject.chapters[0];
    const section = chapter?.sections[0];
    if (!chapter || !section) {
      notify({
        variant: "warning",
        title: "大纲不能为空",
        description: "请至少保留一个章节和一个小节。",
      });
      return;
    }

    try {
      await saveRemoteOutline(draftProject.id, draftProject.chapters);
    } catch (error) {
      notify({
        variant: "warning",
        title: "大纲仅保存在本机",
        description: getErrorMessage(error),
      });
    }

    setState((current) => ({
      ...current,
      projects: [draftProject, ...current.projects.filter((project) => project.id !== draftProject.id)],
      activeProjectId: draftProject.id,
      activeChapterId: chapter.id,
      activeSectionId: section.id,
    }));
    setDraftProject(null);
    go("detail");
  }

  function openSection(project: LearningProject, chapterId: string, sectionId: string) {
    setState((current) => ({
      ...current,
      activeProjectId: project.id,
      activeChapterId: chapterId,
      activeSectionId: sectionId,
    }));
    go("classroom");
  }

  function updateProject(updatedProject: LearningProject) {
    setState((current) => ({
      ...current,
      projects: [
        updatedProject,
        ...current.projects.filter(
          (project) => project.id !== updatedProject.id,
        ),
      ],
    }));
  }

  async function confirmProjectDeletion() {
    if (!projectPendingDeletion || isDeletingProject) return;
    const projectId = projectPendingDeletion.id;
    const projectTitle = projectPendingDeletion.title;
    setIsDeletingProject(true);
    try {
      await deleteRemoteProject(projectId);
      setState((current) => {
        const projects = current.projects.filter(
          (project) => project.id !== projectId,
        );
        if (current.activeProjectId !== projectId) {
          return { ...current, projects };
        }
        const nextProject = projects[0];
        const nextPosition = nextProject
          ? getFirstCoursePosition(nextProject)
          : null;
        return {
          ...current,
          projects,
          activeProjectId: nextProject?.id ?? "",
          activeChapterId: nextPosition?.chapter.id ?? "",
          activeSectionId: nextPosition?.section.id ?? "",
        };
      });
      if (draftProject?.id === projectId) setDraftProject(null);
      setProjectPendingDeletion(null);
      notify({
        variant: "success",
        title: "项目已删除",
        description: `《${projectTitle}》及其学习记录已移除。`,
      });
      go("home");
    } catch (error) {
      notify({
        variant: "error",
        title: "项目删除失败",
        description: getErrorMessage(error),
      });
    } finally {
      setIsDeletingProject(false);
    }
  }

  const showMainNav = ["home", "plan", "review", "stats", "detail"].includes(view);
  const currentGenerationTask =
    generationTasks.find(
      (task) => task.status === "running" || task.status === "queued",
    ) ?? generationTasks[0];

  return (
    <div className="app">
      <GlobalTopBar
        tasks={generationTasks}
        onHome={() => go("home")}
        onSettings={() => go("settings")}
      />

      {view === "home" && (
        <HomePage
          projects={state.projects}
          onCreate={() => go("create")}
          onOpenProject={selectProject}
          onRequestDelete={setProjectPendingDeletion}
        />
      )}
      {view === "plan" && (activeProject ? <PlanPage project={activeProject} onOpenSection={openSection} /> : <EmptyProjectPage title="还没有学习计划" onCreate={() => go("create")} />)}
      {view === "review" && (activeProject ? <ReviewPage project={activeProject} onOpenSection={openSection} /> : <EmptyProjectPage title="还没有可复习内容" onCreate={() => go("create")} />)}
      {view === "stats" && (activeProject ? <StatsPage projects={state.projects} activeProject={activeProject} /> : <EmptyProjectPage title="还没有学习统计" onCreate={() => go("create")} />)}
      {view === "create" && <CreateProjectPage onCancel={() => go("home")} onCreate={startCreate} />}
      {view === "generating" && <GeneratingPage task={currentGenerationTask} />}
      {view === "outline" && draftProject && (
        <OutlinePage
          project={draftProject}
          onBack={() => {
            setDraftProject(null);
            go(outlineReturnView);
          }}
          onNext={finishOutline}
          onRegenerate={regenerateDraftOutline}
          onOptimize={optimizeDraftOutline}
          onChange={updateDraftChapters}
        />
      )}
      {view === "detail" && activeProject && (
        <CourseDetailPage
          project={activeProject}
          onOpenSection={openSection}
          onEditOutline={editProjectOutline}
          onBack={() => go("home")}
        />
      )}
      {view === "classroom" && activeProject && activeChapter && activeSection && (
        <ClassroomPage
          project={activeProject}
          chapter={activeChapter}
          section={activeSection}
          onBack={() => go("detail")}
          onOpenSection={openSection}
          onProjectUpdate={updateProject}
        />
      )}
      {view === "settings" && (
        <SettingsPage
          settings={state.modelSettings}
          onCancel={() => go("home")}
          onSave={async (settings) => {
            try {
              const aiSettings = await updateRemoteAiSettings(settings);
              const searchSettings = await updateRemoteSearchSettings(settings.webSearchApiKey);
              notify({
                variant: "success",
                title: "内容服务与资料搜索设置已保存",
                description:
                  aiSettings.apiKeyPersisted || searchSettings.apiKeyPersisted
                    ? "已提交的密钥使用 Windows 当前用户加密并持久化保存。"
                    : "普通配置已持久化；当前没有需要写入的密钥。",
              });
              setState((current) => ({
                ...current,
                modelSettings: {
                  ...settings,
                  apiKey: "",
                  webSearchApiKey: "",
                },
              }));
              go("home");
            } catch (error) {
              notify({
                variant: "error",
                title: "后端设置保存失败",
                description: getErrorMessage(error),
              });
            }
          }}
        />
      )}

      {projectPendingDeletion ? (
        <div
          className="delete-project-backdrop"
          role="presentation"
          onMouseDown={() => {
            if (!isDeletingProject) setProjectPendingDeletion(null);
          }}
        >
          <section
            className="delete-project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="delete-project-mark" aria-hidden="true">!</span>
            <div>
              <p>删除学习项目</p>
              <h2 id="delete-project-title">
                确定删除《{projectPendingDeletion.title}》吗？
              </h2>
              <span>
                课程大纲、课堂内容、学习记录和复习进度都会一起删除，且无法恢复。
              </span>
            </div>
            <div className="delete-project-actions">
              <button
                className="soft-pill"
                disabled={isDeletingProject}
                onClick={() => setProjectPendingDeletion(null)}
              >
                取消
              </button>
              <button
                className="danger-pill"
                disabled={isDeletingProject}
                onClick={confirmProjectDeletion}
              >
                {isDeletingProject ? "正在删除…" : "确认删除项目"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showMainNav && <FloatingNav activeView={view as MainView} onNavigate={go} />}
    </div>
  );
}

function GlobalTopBar({
  tasks,
  onHome,
  onSettings,
}: {
  tasks: GenerationTask[];
  onHome: () => void;
  onSettings: () => void;
}) {
  const visibleTasks = tasks.slice(0, 8);
  const activeTasks = tasks.filter(
    (task) => task.status === "running" || task.status === "queued",
  );
  const primaryTask = activeTasks[0];
  return (
    <header className="global-bar">
      <button className="brand-dot" onClick={onHome} aria-label="返回首页">圆</button>
      <details className="generation-center">
        <summary
          className={primaryTask ? "generation-summary is-active" : "generation-summary"}
        >
          <span className="generation-summary-signal" aria-hidden="true" />
          <span>
            <strong>
              {primaryTask
                ? primaryTask.stage
                : visibleTasks.length
                  ? "生成记录"
                  : "当前没有生成任务"}
            </strong>
            <small>
              {primaryTask
                ? `${activeTasks.length} 项进行中 · ${primaryTask.title}`
                : visibleTasks.length
                  ? "查看最近完成情况"
                  : "开始生成后，进度会显示在这里"}
            </small>
          </span>
          {typeof primaryTask?.progress === "number" ? (
            <em>{primaryTask.progress}%</em>
          ) : null}
        </summary>
        <section className="generation-panel">
          <header>
            <div>
              <span>后台任务</span>
              <h2>
                {activeTasks.length
                  ? `${activeTasks.length} 项正在准备`
                  : "最近生成记录"}
              </h2>
            </div>
            <small>页面可以正常切换</small>
          </header>
          <div className="generation-task-list">
            {visibleTasks.length ? (
              visibleTasks.map((task) => (
                <article
                  className={`generation-task generation-task--${task.status}`}
                  key={task.id}
                >
                  <span className="generation-task-mark" aria-hidden="true" />
                  <div>
                    <strong>{task.title}</strong>
                    <p>{task.stage}</p>
                    {task.detail ? <small>{task.detail}</small> : null}
                    {task.error ? <small className="task-error">{task.error}</small> : null}
                    <div className="generation-task-track" aria-hidden="true">
                      <i style={{ width: `${task.progress ?? 0}%` }} />
                    </div>
                  </div>
                  <em>
                    {task.status === "completed"
                      ? "完成"
                      : task.status === "failed"
                        ? "失败"
                        : task.status === "queued"
                          ? "等待"
                          : `${task.progress ?? "…"}%`}
                  </em>
                </article>
              ))
            ) : (
              <p className="generation-empty">
                生成课程、大纲、课堂或助教回复时，这里会显示当前步骤。
              </p>
            )}
          </div>
        </section>
      </details>
      <div className="bar-actions">
        <button className="icon-button" onClick={onSettings} aria-label="设置">⚙</button>
        <button className="icon-button" aria-label="主题">◐</button>
      </div>
    </header>
  );
}

function HomePage({
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
  return (
    <main className="page">
      <section className="page-intro">
        <p>早上好，开启今天的学习之旅吧</p>
        <h1>我的学习项目</h1>
      </section>

      <section className="project-grid">
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

      {projects.length > 0 && <button className="floating-create" onClick={onCreate} aria-label="创建项目">＋</button>}
    </main>
  );
}

function EmptyProjectPage({ title, onCreate }: { title: string; onCreate: () => void }) {
  return (
    <main className="page">
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
    <main className="page">
      <section className="empty-project-card empty-project-card--page">
        <span>!</span>
        <h1>{projectTitle} 暂无可学习内容</h1>
        <p>请返回项目大纲，至少添加一个章节和一个小节后再继续。</p>
      </section>
    </main>
  );
}

function PlanPage({
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

  return (
    <main className="page">
      <section className="page-intro">
        <p>{project.title}</p>
        <h1>今天的学习节奏</h1>
      </section>

      <section className="plan-layout">
        <div className="plan-summary-card">
          <ProgressRing value={Math.min(100, Math.max(18, project.progress))} tone={1} large />
          <div>
            <p>今日计划</p>
            <h2>{activeTasks.length} 项任务待推进</h2>
            <span>建议先完成当前小节，再处理复习和练习。</span>
          </div>
          <button
            className="primary-pill"
            disabled={!firstTask}
            onClick={() => firstTask && onOpenSection(project, firstTask.chapter.id, firstTask.section.id)}
          >
            开始今日任务
          </button>
        </div>

        <div className="week-strip">
          {["周一", "周二", "今天", "周四", "周五", "周六", "周日"].map((day) => (
            <button className={day === "今天" ? "active" : ""} key={day}>{day}</button>
          ))}
        </div>

        <section className="task-list-card">
          <div className="panel-title">
            <p>今日任务</p>
            <h2>按章节推进</h2>
          </div>
          {tasks.slice(0, 6).map((task) => (
            <button
              className={`task-row task-row--${task.section.status}`}
              key={task.section.id}
              onClick={() => onOpenSection(project, task.chapter.id, task.section.id)}
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

function ReviewPage({
  project,
  onOpenSection,
}: {
  project: LearningProject;
  onOpenSection: (project: LearningProject, chapterId: string, sectionId: string) => void;
}) {
  const currentPosition = getFirstCoursePosition(project);

  if (!currentPosition) {
    return <EmptyCourseStructure projectTitle={project.title} />;
  }

  const { chapter: currentChapter, section: currentSection } = currentPosition;

  return (
    <main className="page">
      <section className="page-intro">
        <p>{project.title}</p>
        <h1>今天轻松回顾</h1>
      </section>

      <section className="review-grid">
        <div className="review-start-card">
          <div className="review-orb">
            <span>18</span>
            <small>待复习</small>
          </div>
          <h2>先处理薄弱点，再进入新内容</h2>
          <p>系统建议从「{project.weakPoints[0] ?? "当前小节"}」开始，用 12 分钟完成一次快速回顾。</p>
          <button className="primary-pill" onClick={() => onOpenSection(project, currentChapter.id, currentSection.id)}>
            开始复习
          </button>
        </div>

        <div className="review-stats">
          <StatusCard label="薄弱项" value={`${project.weakPoints.length || 1} 个`} />
          <StatusCard label="今日已复习" value="12 题" />
          <StatusCard label="加入题集" value="8 题" />
        </div>

        <section className="review-type-grid">
          {[
            ["错题复习", "6 道待处理", "✎"],
            ["单词回顾", "12 个需巩固", "字"],
            ["知识点巩固", "3 个薄弱点", "◎"],
            ["收藏内容", "5 条笔记", "☆"],
          ].map(([title, detail, icon]) => (
            <button className="review-type-card" key={title}>
              <span>{icon}</span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </button>
          ))}
        </section>
      </section>
    </main>
  );
}

function StatsPage({ projects, activeProject }: { projects: LearningProject[]; activeProject: LearningProject }) {
  const averageProgress = Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / Math.max(1, projects.length));
  const totalMinutes = projects.reduce((sum, project) => sum + project.weeklyMinutes, 0);

  return (
    <main className="page">
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
          <StatusCard label="本周学习" value={`${totalMinutes} 分钟`} />
          <StatusCard label="连续学习" value="7 天" />
          <StatusCard label="完成任务" value="14 项" />
          <StatusCard label="平均正确率" value={`${activeProject.accuracy}%`} />
        </section>

        <div className="stats-bottom-grid">
          <section className="bubble-card">
            <div className="panel-title">
              <p>学科分布</p>
              <h2>投入占比</h2>
            </div>
            <div className="subject-bubbles">
              {projects.map((project, index) => (
                <span className={`subject-bubble subject-bubble--${index % 3}`} key={project.id} style={{ width: 104 + index * 18, height: 104 + index * 18 }}>
                  {project.title.slice(0, 4)}
                  <small>{project.progress}%</small>
                </span>
              ))}
            </div>
          </section>

          <section className="trend-card">
            <div className="panel-title">
              <p>近 7 天</p>
              <h2>学习连续性</h2>
            </div>
            <div className="day-dots">
              {[35, 54, 48, 68, 72, 60, 82].map((height, index) => (
                <span key={index} style={{ height }}>
                  <i />
                  <small>{["一", "二", "三", "四", "五", "六", "日"][index]}</small>
                </span>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function CreateProjectPage({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (
    topic: string,
    description: string,
    preferences: OutlinePreferences,
  ) => void;
}) {
  const { notify } = useToast();
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [preferenceRecommendations, setPreferenceRecommendations] =
    useState<PreferenceRecommendations>({});
  const [step, setStep] = useState<"basics" | "preferences">("basics");
  const [preferenceDraft, setPreferenceDraft] = useState<
    Record<
      keyof OutlinePreferences,
      { selected: string; custom: string }
    >
  >({
    learningGoal: { selected: "__skip__", custom: "" },
    currentLevel: { selected: "__skip__", custom: "" },
    coveragePreference: { selected: "__skip__", custom: "" },
    timeBudget: { selected: "__skip__", custom: "" },
    sessionLength: { selected: "__skip__", custom: "" },
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  async function handleGenerateDescription() {
    if (!topic.trim() || isGeneratingDescription) return;
    setIsGeneratingDescription(true);
    try {
      const generatedDescription = await generateRemoteProjectDescription(topic);
      setDescription(generatedDescription);
      notify({
        variant: "success",
        title: "内容描述已生成",
        description: "你可以继续修改，再创建项目。",
      });
    } catch (error) {
      notify({
        variant: "error",
        title: "描述生成失败",
        description: getErrorMessage(error),
      });
    } finally {
      setIsGeneratingDescription(false);
    }
  }

  function updatePreference(
    key: keyof OutlinePreferences,
    update: Partial<{ selected: string; custom: string }>,
  ) {
    setPreferenceDraft((current) => ({
      ...current,
      [key]: { ...current[key], ...update },
    }));
  }

  function resolvePreferences(): OutlinePreferences {
    return Object.fromEntries(
      Object.entries(preferenceDraft).flatMap(([key, value]) => {
        if (value.selected === "__skip__") return [];
        const resolved =
          value.selected === "__custom__"
            ? value.custom.trim()
            : value.selected;
        return resolved ? [[key, resolved]] : [];
      }),
    ) as OutlinePreferences;
  }

  async function handleContinueToPreferences() {
    if (!topic.trim() || isGeneratingDescription) return;
    setStep("preferences");
    setPreferenceRecommendations({});
    setIsLoadingRecommendations(true);
    try {
      setPreferenceRecommendations(
        await getRemotePreferenceRecommendations(topic, description),
      );
    } catch {
      setPreferenceRecommendations({});
    } finally {
      setIsLoadingRecommendations(false);
    }
  }

  if (step === "preferences") {
    return (
      <main className="center-page center-page--wide">
        <section className="form-card preference-card">
          <div className="form-head">
            <button
              className="icon-button"
              onClick={() => setStep("basics")}
              aria-label="返回填写课题"
            >
              ←
            </button>
            <div className="form-head-copy">
              <span>第 2 步，共 2 步</span>
              <h1>让课程更贴合你</h1>
              <p>时间与内容范围分开设置；拿不准的部分可以交给课程规划。</p>
            </div>
            <span />
          </div>

          <div
            className={`preference-guidance${isLoadingRecommendations ? " is-loading" : ""}`}
            role="status"
          >
            <i aria-hidden="true">{isLoadingRecommendations ? "…" : "✓"}</i>
            <span>
              <strong>
                {isLoadingRecommendations
                  ? "正在结合课题整理建议"
                  : Object.keys(preferenceRecommendations).length
                    ? "已标出可参考的选项"
                    : "没有依据的内容不会替你猜"}
              </strong>
              <small>建议不会自动选中，你仍然可以忽略或自己填写。</small>
            </span>
          </div>

          <div className="preference-list">
            {preferenceQuestions.map((question) => (
              <PreferenceQuestion
                key={question.key}
                title={question.title}
                description={question.description}
                value={preferenceDraft[question.key]}
                options={question.options}
                skipLabel={question.skipLabel}
                customPlaceholder={question.customPlaceholder}
                recommendedOption={preferenceRecommendations[question.key]}
                wide={question.wide}
                onChange={(update) => updatePreference(question.key, update)}
              />
            ))}
          </div>

          <button
            className="primary-pill"
            onClick={() => onCreate(topic, description, resolvePreferences())}
          >
            开始规划课程 →
          </button>
          <button className="text-button" onClick={() => setStep("basics")}>
            返回修改课题
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="center-page">
      <section className="form-card">
        <div className="form-head">
          <button className="icon-button" onClick={onCancel} aria-label="返回">←</button>
          <h1>创建项目</h1>
          <span />
        </div>
        <label>
          课题名称
          <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如：古诗文背诵" />
        </label>
        <div className="form-field">
          <div className="field-label-row">
            <label htmlFor="project-description">内容描述</label>
            <button
              className={`agent-field-button ${isGeneratingDescription ? "is-working" : ""}`}
              disabled={!topic.trim() || isGeneratingDescription}
              title={
                topic.trim()
                  ? "根据课题名称生成内容描述"
                  : "请先填写课题名称"
              }
              type="button"
              onClick={handleGenerateDescription}
            >
              <i aria-hidden="true">✦</i>
              {isGeneratingDescription
                ? "正在生成…"
                : description.trim()
                  ? "重新生成"
                  : "帮我生成"}
            </button>
          </div>
          <textarea
            id="project-description"
            value={description}
            aria-busy={isGeneratingDescription}
            readOnly={isGeneratingDescription}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={
              topic.trim()
                ? "可以手动填写，也可以根据课题名称自动补充…"
                : "例如：每天背诵 3 首，整理意象并记录感悟..."
            }
            rows={5}
          />
          <small className="field-help">
            这里只补充学习范围和内容组织；你的基础、目标和时间安排在下一步选择。
          </small>
        </div>
        <div className="create-orb">✓</div>
        <button
          className="primary-pill"
          disabled={!topic.trim() || isGeneratingDescription}
          onClick={handleContinueToPreferences}
        >
          下一步：设置学习方式 →
        </button>
        <button className="text-button" onClick={onCancel}>取消并返回主界面</button>
      </section>
    </main>
  );
}

function PreferenceQuestion({
  title,
  description,
  value,
  options,
  skipLabel,
  customPlaceholder,
  recommendedOption,
  wide = false,
  onChange,
}: {
  title: string;
  description: string;
  value: { selected: string; custom: string };
  options: readonly string[];
  skipLabel: string;
  customPlaceholder: string;
  recommendedOption?: string;
  wide?: boolean;
  onChange: (update: Partial<{ selected: string; custom: string }>) => void;
}) {
  return (
    <fieldset
      className={`preference-question${wide ? " preference-question--wide" : ""}`}
    >
      <legend>{title}</legend>
      <p>{description}</p>
      <div className="preference-options">
        {options.map((option) => (
          <button
            className={value.selected === option ? "is-selected" : ""}
            key={option}
            type="button"
            onClick={() => onChange({ selected: option })}
          >
            <span>{option}</span>
            {recommendedOption === option ? (
              <small className="preference-recommendation">建议</small>
            ) : null}
          </button>
        ))}
        <button
          className={value.selected === "__skip__" ? "is-selected is-skip" : "is-skip"}
          type="button"
          onClick={() => onChange({ selected: "__skip__" })}
        >
          {skipLabel}
        </button>
        <button
          className={value.selected === "__custom__" ? "is-selected" : ""}
          type="button"
          onClick={() => onChange({ selected: "__custom__" })}
        >
          自己填写
        </button>
      </div>
      {value.selected === "__custom__" ? (
        <input
          autoFocus
          maxLength={240}
          value={value.custom}
          onChange={(event) => onChange({ custom: event.target.value })}
          placeholder={customPlaceholder}
        />
      ) : null}
    </fieldset>
  );
}

function GeneratingPage({ task }: { task?: GenerationTask }) {
  const progress = task?.progress ?? 4;
  return (
    <main className="center-page">
      <section className="generating-card">
        <div className="orbit-loader"><span /><span /><span /></div>
        <span className="generating-eyebrow">
          {task?.status === "queued" ? "即将开始" : "课程正在准备"}
        </span>
        <h1>{task?.stage ?? "正在建立生成任务"}</h1>
        <p>
          {task?.detail ??
            "服务端正在接收课程要求，接下来会持续显示真实处理步骤。"}
        </p>
        <div className="generating-progress" aria-label={`当前进度 ${progress}%`}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <div className="generating-readout">
          <span>{task?.title ?? "生成学习路线"}</span>
          <strong>{progress}%</strong>
        </div>
      </section>
    </main>
  );
}

function OutlinePage({
  project,
  onBack,
  onNext,
  onRegenerate,
  onOptimize,
  onChange,
}: {
  project: LearningProject;
  onBack: () => void;
  onNext: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  onOptimize: () => Promise<void>;
  onChange: (chapters: CourseChapter[]) => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isReplanConfirming, setIsReplanConfirming] = useState(false);
  const [chapterPendingRemoval, setChapterPendingRemoval] = useState<string | null>(
    null,
  );
  const manualNodeCount = project.chapters.reduce(
    (count, chapter) =>
      count +
      (isUserAddedOutlineNode(chapter) ? 1 : 0) +
      chapter.sections.filter(isUserAddedOutlineNode).length,
    0,
  );
  const isLegacyFallbackOutline =
    Boolean(project.generation?.warning) &&
    !project.outlineAudit &&
    project.chapters.length === 1 &&
    project.chapters[0].sections.length <= 2 &&
    /大纲生成未完成|等待重新规划|基础认知|核心概念|基本方法/.test(
      [
        project.chapters[0].title,
        ...project.chapters[0].sections.map((section) => section.title),
      ].join(" "),
    );
  const isFallbackOutline =
    project.generation?.outlineStatus === "fallback" ||
    isLegacyFallbackOutline;
  const sectionCount = project.chapters.reduce(
    (count, chapter) => count + chapter.sections.length,
    0,
  );
  const estimatedHours =
    project.outlineSummary?.estimatedHours ??
    project.chapters.reduce(
      (total, chapter) => total + (chapter.estimatedHours ?? 0),
      0,
    );
  const emptyTitleCount = project.chapters.reduce(
    (count, chapter) =>
      count +
      (chapter.title.trim() ? 0 : 1) +
      chapter.sections.filter((section) => !section.title.trim()).length,
    0,
  );
  const missingOutcomeCount = project.chapters.reduce(
    (count, chapter) =>
      count + chapter.sections.filter((section) => !section.outcome?.trim()).length,
    0,
  );
  const hasCompleteStructure =
    project.chapters.length > 0 &&
    project.chapters.every((chapter) => chapter.sections.length > 0);
  const canContinue =
    hasCompleteStructure &&
    emptyTitleCount === 0 &&
    (!isFallbackOutline || manualNodeCount > 0);

  function updateChapter(chapterId: string, title: string) {
    onChange(project.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, title } : chapter)));
  }

  function updateChapterObjective(chapterId: string, objective: string) {
    onChange(
      project.chapters.map((chapter) =>
        chapter.id === chapterId ? { ...chapter, objective } : chapter,
      ),
    );
  }

  function updateSection(chapterId: string, sectionId: string, title: string) {
    onChange(
      project.chapters.map((chapter) =>
        chapter.id === chapterId
          ? { ...chapter, sections: chapter.sections.map((section) => (section.id === sectionId ? { ...section, title } : section)) }
          : chapter,
      ),
    );
  }

  function updateSectionOutcome(
    chapterId: string,
    sectionId: string,
    outcome: string,
  ) {
    onChange(
      project.chapters.map((chapter) =>
        chapter.id === chapterId
          ? {
              ...chapter,
              sections: chapter.sections.map((section) =>
                section.id === sectionId ? { ...section, outcome } : section,
              ),
            }
          : chapter,
      ),
    );
  }

  function moveChapter(chapterIndex: number, direction: -1 | 1) {
    const targetIndex = chapterIndex + direction;
    if (targetIndex < 0 || targetIndex >= project.chapters.length) return;
    const chapters = [...project.chapters];
    [chapters[chapterIndex], chapters[targetIndex]] = [
      chapters[targetIndex],
      chapters[chapterIndex],
    ];
    onChange(chapters);
  }

  function moveSection(
    chapterId: string,
    sectionIndex: number,
    direction: -1 | 1,
  ) {
    onChange(
      project.chapters.map((chapter) => {
        if (chapter.id !== chapterId) return chapter;
        const targetIndex = sectionIndex + direction;
        if (targetIndex < 0 || targetIndex >= chapter.sections.length) {
          return chapter;
        }
        const sections = [...chapter.sections];
        [sections[sectionIndex], sections[targetIndex]] = [
          sections[targetIndex],
          sections[sectionIndex],
        ];
        return { ...chapter, sections };
      }),
    );
  }

  function addChapter() {
    const previousDifficulty = project.chapters.at(-1)?.difficulty ?? 1;
    onChange([
      ...project.chapters,
      {
        id: crypto.randomUUID(),
        title: `第${project.chapters.length + 1}章 新章节`,
        origin: "user",
        difficulty: Math.min(5, previousDifficulty + 1) as 1 | 2 | 3 | 4 | 5,
        objective: "填写本章可验证的学习目标",
        prerequisites: [],
        estimatedHours: 2,
        sections: [{
          id: crypto.randomUUID(),
          title: "新小节",
          status: "locked",
          origin: "user",
          kind: "concept",
          outcome: "填写本节完成后可以做到什么",
        }],
      },
    ]);
  }

  function addSection(chapterId: string) {
    onChange(
      project.chapters.map((chapter) =>
        chapter.id === chapterId
          ? {
              ...chapter,
              sections: [
                ...chapter.sections,
                {
                  id: crypto.randomUUID(),
                  title: "新小节",
                  status: "locked",
                  origin: "user",
                  kind: "concept",
                  outcome: "填写本节完成后可以做到什么",
                },
              ],
            }
          : chapter,
      ),
    );
  }

  function removeSection(chapterId: string, sectionId: string) {
    onChange(
      project.chapters.map((chapter) =>
        chapter.id === chapterId && chapter.sections.length > 1
          ? {
              ...chapter,
              sections: chapter.sections.filter((section) => section.id !== sectionId),
            }
          : chapter,
      ),
    );
  }

  function removeChapter(chapterId: string) {
    if (project.chapters.length <= 1) return;
    onChange(project.chapters.filter((chapter) => chapter.id !== chapterId));
    setChapterPendingRemoval(null);
  }

  async function handleNext() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onNext();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleOptimize() {
    if (isOptimizing || manualNodeCount === 0) return;
    setIsOptimizing(true);
    try {
      await onOptimize();
    } finally {
      setIsOptimizing(false);
    }
  }

  async function handleRegenerate() {
    if (isRegenerating) return;
    setIsRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setIsRegenerating(false);
      setIsReplanConfirming(false);
    }
  }

  function getSourceHost(url: string) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "参考资料";
    }
  }

  return (
    <main className="page outline-page">
      <header className="outline-hero">
        <div className="outline-hero-top">
          <button className="icon-button" onClick={onBack} aria-label="返回创建项目">
            ←
          </button>
          <div className="outline-hero-copy">
            <span>课程规划</span>
            <h1>确认你的学习路线</h1>
            <p>
              先看课程是否覆盖了你真正想学的内容，再调整顺序和颗粒度。
              保存后，每个小节都会成为一堂独立课堂。
            </p>
          </div>
          <div className="outline-hero-actions">
            {isReplanConfirming ? (
              <button
                className="outline-cancel-replan"
                disabled={isRegenerating}
                onClick={() => setIsReplanConfirming(false)}
              >
                取消
              </button>
            ) : null}
            <button
              className={isReplanConfirming ? "outline-replan is-confirming" : "outline-replan"}
              disabled={isRegenerating}
              onClick={() => {
                if (isReplanConfirming) {
                  void handleRegenerate();
                  return;
                }
                setIsReplanConfirming(true);
              }}
            >
              {isRegenerating
                ? "正在重新规划…"
                : isReplanConfirming
                  ? "确认重新规划"
                  : "重新规划"}
            </button>
          </div>
        </div>

        <div className="outline-hero-stats" aria-label="课程规模">
          <div>
            <strong>{project.chapters.length}</strong>
            <span>章</span>
          </div>
          <div>
            <strong>{sectionCount}</strong>
            <span>堂课</span>
          </div>
          <div>
            <strong>{estimatedHours || "—"}</strong>
            <span>预计小时</span>
          </div>
          <div>
            <strong>{project.outlinePlan?.sessionMinutes ?? "—"}</strong>
            <span>分钟 / 次</span>
          </div>
        </div>
      </header>

      {project.outlineSummary ? (
        <section className="outline-brief">
          <div className="outline-brief-primary">
            <span>这门课最终要做到</span>
            <h2>{project.outlineSummary.courseGoal}</h2>
          </div>
          <div className="outline-brief-audience">
            <span>从哪里开始</span>
            <strong>
              {project.outlinePlan?.priorKnowledge ??
                project.outlineSummary.audience}
            </strong>
          </div>
        </section>
      ) : null}

      {isFallbackOutline ? (
        <section className="outline-fallback-alert" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <strong>这份课程结构没有生成完整</strong>
            <p>
              {project.generation?.warning ??
                "返回内容未通过结构检查，系统暂时保留了一章临时内容。"}
            </p>
            <small>
              重新规划会保留你的课题、目标和学习偏好，并重新整理完整章节。
            </small>
          </div>
          <button
            className="primary-pill"
            disabled={isRegenerating}
            onClick={handleRegenerate}
          >
            {isRegenerating ? "正在重新规划…" : "重新规划课程"}
          </button>
        </section>
      ) : null}

      <div className="outline-workbench">
        <section className="outline-route">
          <div className="outline-section-head">
            <div>
              <span>课程路线</span>
              <h2>按学习顺序检查每一章</h2>
              <p>标题说明学什么，完成目标说明学完后能做什么。</p>
            </div>
            <button
              className="soft-pill outline-polish"
              disabled={isOptimizing || manualNodeCount === 0}
              title={
                manualNodeCount
                  ? "整理手动新增节点的标题与学习目标"
                  : "添加章节或小节后可以使用"
              }
              onClick={handleOptimize}
            >
              {isOptimizing
                ? "正在整理…"
                : manualNodeCount
                  ? `整理新增内容 · ${manualNodeCount}`
                  : "新增内容可在这里整理"}
            </button>
          </div>

          <div className="outline-chapter-list">
            {project.chapters.map((chapter, chapterIndex) => (
              <article className="chapter-block chapter-block--editor" key={chapter.id}>
                <header className="chapter-editor-head">
                  <div className="chapter-sequence">
                    <small>CHAPTER</small>
                    <strong>{String(chapterIndex + 1).padStart(2, "0")}</strong>
                  </div>
                  <div className="chapter-title chapter-title--editor">
                    <label htmlFor={`chapter-title-${chapter.id}`}>章节名称</label>
                    <input
                      id={`chapter-title-${chapter.id}`}
                      value={chapter.title}
                      className={chapter.title.trim() ? "" : "is-invalid"}
                      onChange={(event) =>
                        updateChapter(chapter.id, event.target.value)
                      }
                    />
                  </div>
                  <div className="outline-order-actions" aria-label="调整章节顺序">
                    <button
                      disabled={chapterIndex === 0}
                      onClick={() => moveChapter(chapterIndex, -1)}
                      aria-label={`上移${chapter.title}`}
                      title="上移章节"
                    >
                      ↑
                    </button>
                    <button
                      disabled={chapterIndex === project.chapters.length - 1}
                      onClick={() => moveChapter(chapterIndex, 1)}
                      aria-label={`下移${chapter.title}`}
                      title="下移章节"
                    >
                      ↓
                    </button>
                    <button
                      className="is-danger"
                      disabled={project.chapters.length <= 1}
                      onClick={() => setChapterPendingRemoval(chapter.id)}
                      aria-label={`删除${chapter.title}`}
                      title={
                        project.chapters.length <= 1
                          ? "课程至少需要保留一章"
                          : "删除章节"
                      }
                    >
                      ×
                    </button>
                  </div>
                </header>

                {chapterPendingRemoval === chapter.id ? (
                  <div className="chapter-remove-confirm" role="alert">
                    <span>
                      删除本章会同时移除其中 {chapter.sections.length} 堂课。
                    </span>
                    <button onClick={() => setChapterPendingRemoval(null)}>
                      保留
                    </button>
                    <button
                      className="is-danger"
                      onClick={() => removeChapter(chapter.id)}
                    >
                      确认删除
                    </button>
                  </div>
                ) : null}

                <div className="chapter-editor-meta">
                  <span
                    className={`difficulty-badge difficulty-badge--${chapter.difficulty ?? 1}`}
                    role="img"
                    aria-label={`难度 ${chapter.difficulty ?? 1} 星，${difficultyLabels[chapter.difficulty ?? 1]}`}
                    title={`难度 ${chapter.difficulty ?? 1} 星 · ${difficultyLabels[chapter.difficulty ?? 1]}`}
                  >
                    <span className="difficulty-stars" aria-hidden="true">
                      {Array.from({ length: 5 }, (_, starIndex) => (
                        <span
                          className={
                            starIndex < (chapter.difficulty ?? 1)
                              ? "difficulty-star difficulty-star--filled"
                              : "difficulty-star difficulty-star--empty"
                          }
                          key={starIndex}
                        >
                          {starIndex < (chapter.difficulty ?? 1) ? "★" : "☆"}
                        </span>
                      ))}
                    </span>
                    <span className="difficulty-label" aria-hidden="true">
                      {difficultyLabels[chapter.difficulty ?? 1]}
                    </span>
                  </span>
                  {chapter.estimatedHours ? (
                    <span>约 {chapter.estimatedHours} 小时</span>
                  ) : null}
                  <span>{chapter.sections.length} 堂课</span>
                  {chapter.prerequisites?.length ? (
                    <span>前置：{chapter.prerequisites.join("、")}</span>
                  ) : null}
                </div>

                <label className="chapter-objective">
                  <span>本章完成后</span>
                  <input
                    value={chapter.objective ?? ""}
                    placeholder="写清楚学完这一章能够完成什么"
                    onChange={(event) =>
                      updateChapterObjective(chapter.id, event.target.value)
                    }
                  />
                </label>

                <div className="section-list section-list--editor">
                  {chapter.sections.map((section, sectionIndex) => (
                    <div className="section-row section-row--editor" key={section.id}>
                      <div className="section-index">
                        <small>
                          {chapterIndex + 1}.{sectionIndex + 1}
                        </small>
                        <span>
                          {section.kind
                            ? sectionKindLabels[section.kind]
                            : "学习"}
                        </span>
                      </div>
                      <div className="section-copy section-copy--editor">
                        <label htmlFor={`section-title-${section.id}`}>
                          小节名称
                        </label>
                        <input
                          id={`section-title-${section.id}`}
                          value={section.title}
                          className={section.title.trim() ? "" : "is-invalid"}
                          onChange={(event) =>
                            updateSection(
                              chapter.id,
                              section.id,
                              event.target.value,
                            )
                          }
                        />
                        <label htmlFor={`section-outcome-${section.id}`}>
                          完成后可以
                        </label>
                        <input
                          id={`section-outcome-${section.id}`}
                          value={section.outcome ?? ""}
                          placeholder="例如：能独立判断一个业务场景该用哪种方案"
                          onChange={(event) =>
                            updateSectionOutcome(
                              chapter.id,
                              section.id,
                              event.target.value,
                            )
                          }
                        />
                        {section.estimatedMinutes || section.practiceMinutes ? (
                          <small className="section-time">
                            {section.estimatedMinutes
                              ? `课堂 ${section.estimatedMinutes} 分钟`
                              : ""}
                            {section.estimatedMinutes && section.practiceMinutes
                              ? " · "
                              : ""}
                            {section.practiceMinutes
                              ? `练习 ${section.practiceMinutes} 分钟`
                              : ""}
                          </small>
                        ) : null}
                        {section.strategy ? (
                          <details className="section-strategy-preview">
                            <summary>
                              <span>
                                {knowledgeRoleLabels[section.strategy.role]}
                              </span>
                              查看课程中的作用与难点
                            </summary>
                            <div>
                              <p>
                                <small>为什么现在学</small>
                                {section.strategy.whyNow}
                              </p>
                              <p>
                                <small>后面用在</small>
                                {section.strategy.futureUses.join("；")}
                              </p>
                              <p>
                                <small>主要难点</small>
                                {section.strategy.difficulty.factors
                                  .map((factor) => factor.reason)
                                  .join("；")}
                              </p>
                              <p>
                                <small>学会的证据</small>
                                {section.strategy.successEvidence.join("；")}
                              </p>
                            </div>
                          </details>
                        ) : null}
                      </div>
                      <div
                        className="outline-order-actions outline-order-actions--section"
                        aria-label="调整小节顺序"
                      >
                        <button
                          disabled={sectionIndex === 0}
                          onClick={() =>
                            moveSection(chapter.id, sectionIndex, -1)
                          }
                          aria-label={`上移${section.title}`}
                          title="上移小节"
                        >
                          ↑
                        </button>
                        <button
                          disabled={sectionIndex === chapter.sections.length - 1}
                          onClick={() =>
                            moveSection(chapter.id, sectionIndex, 1)
                          }
                          aria-label={`下移${section.title}`}
                          title="下移小节"
                        >
                          ↓
                        </button>
                        <button
                          className="is-danger"
                          disabled={chapter.sections.length <= 1}
                          onClick={() =>
                            removeSection(chapter.id, section.id)
                          }
                          aria-label={`删除${section.title}`}
                          title={
                            chapter.sections.length <= 1
                              ? "每章至少需要保留一节"
                              : "删除小节"
                          }
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    className="add-line"
                    onClick={() => addSection(chapter.id)}
                  >
                    ＋ 在本章添加一堂课
                  </button>
                </div>
              </article>
            ))}
          </div>

          <button className="add-chapter" onClick={addChapter}>
            <span>＋</span>
            <strong>添加一个新章节</strong>
            <small>适合补充当前路线尚未覆盖的主题</small>
          </button>
        </section>

        <aside className="outline-inspector">
          <section className="outline-check-card">
            <div className="outline-check-head">
              <span className={canContinue ? "is-ready" : ""}>
                {canContinue ? "✓" : "!"}
              </span>
              <div>
                <small>路线检查</small>
                <h2>{canContinue ? "可以开始学习" : "还有内容需要处理"}</h2>
              </div>
            </div>
            <div className="outline-check-list">
              <div className={hasCompleteStructure ? "is-done" : ""}>
                <span>{hasCompleteStructure ? "✓" : "·"}</span>
                <p>
                  <strong>章节结构</strong>
                  <small>
                    {hasCompleteStructure
                      ? `${project.chapters.length} 章、${sectionCount} 堂课`
                      : "每章至少保留一堂课"}
                  </small>
                </p>
              </div>
              <div className={emptyTitleCount === 0 ? "is-done" : ""}>
                <span>{emptyTitleCount === 0 ? "✓" : emptyTitleCount}</span>
                <p>
                  <strong>名称完整</strong>
                  <small>
                    {emptyTitleCount === 0
                      ? "章节与小节都有清晰名称"
                      : `还有 ${emptyTitleCount} 处名称为空`}
                  </small>
                </p>
              </div>
              <div className={missingOutcomeCount === 0 ? "is-done" : ""}>
                <span>{missingOutcomeCount === 0 ? "✓" : missingOutcomeCount}</span>
                <p>
                  <strong>学习结果</strong>
                  <small>
                    {missingOutcomeCount === 0
                      ? "每堂课都有明确结果"
                      : `${missingOutcomeCount} 堂课尚未说明学完能做什么`}
                  </small>
                </p>
              </div>
              <div className={!isFallbackOutline ? "is-done" : ""}>
                <span>{!isFallbackOutline ? "✓" : "!"}</span>
                <p>
                  <strong>课程范围</strong>
                  <small>
                    {isFallbackOutline
                      ? "当前结构没有完整生成"
                      : project.outlineAudit?.coverage ??
                        "已按课程目标确定学习范围"}
                  </small>
                </p>
              </div>
            </div>
          </section>

          {project.outlinePlan ? (
            <section className="outline-plan-card">
              <span>为什么这样规划</span>
              <h2>{project.outlinePlan.courseType}</h2>
              <p>{project.outlinePlan.targetOutcome}</p>
              <div>
                <small>
                  {project.outlinePlan.depth === "intro"
                    ? "入门"
                    : project.outlinePlan.depth === "deep"
                      ? "深入"
                      : "标准深度"}
                </small>
                <small>{project.outlineSummary?.audience}</small>
              </div>
              {project.outlineAudit?.changes.length ? (
                <details>
                  <summary>本轮做了哪些调整</summary>
                  <ul>
                    {project.outlineAudit.changes.map((change, index) => (
                      <li key={`${change}-${index}`}>{change}</li>
                    ))}
                  </ul>
                </details>
              ) : project.outlinePlan.assumptions.length ? (
                <details>
                  <summary>查看采用的默认判断</summary>
                  <ul>
                    {project.outlinePlan.assumptions.map(
                      (assumption, index) => (
                        <li key={`${assumption}-${index}`}>{assumption}</li>
                      ),
                    )}
                  </ul>
                </details>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>

      {project.sources?.length ? (
        <details className="outline-sources">
          <summary>
            <span>
              <small>资料依据</small>
              <strong>{project.sources.length} 项资料参与了本次规划</strong>
            </span>
            <span className="outline-source-hosts">
              {Array.from(
                new Set(project.sources.map((source) => getSourceHost(source.url))),
              )
                .slice(0, 3)
                .map((host) => (
                  <small key={host}>{host}</small>
                ))}
            </span>
            <i aria-hidden="true">＋</i>
          </summary>
          <div className="source-list">
            {project.sources.map((source, index) => (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                key={`${source.url}-${index}`}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{getSourceHost(source.url)}</small>
                  <strong>{source.title}</strong>
                  <p>{source.snippet}</p>
                </div>
                <i aria-hidden="true">↗</i>
              </a>
            ))}
          </div>
        </details>
      ) : null}

      <div className="bottom-action outline-bottom-action">
        <div>
          <span>{canContinue ? "路线已可用" : "保存前还需检查"}</span>
          <strong>
            {canContinue
              ? `${project.chapters.length} 章 · ${sectionCount} 堂课，将按当前顺序创建`
              : emptyTitleCount
                ? `请补全 ${emptyTitleCount} 处空白名称`
                : "请先补全课程结构"}
          </strong>
        </div>
        <button
          className="primary-pill"
          disabled={isSaving || !canContinue}
          title={
            !canContinue
              ? "请先重新规划课程，或手动补充章节后再继续"
              : undefined
          }
          onClick={handleNext}
        >
          {isSaving
            ? "正在保存…"
            : canContinue
              ? "保存路线并进入课程 →"
              : "请先重新规划课程"}
        </button>
      </div>
    </main>
  );
}

function CourseDetailPage({
  project,
  onOpenSection,
  onEditOutline,
  onBack,
}: {
  project: LearningProject;
  onOpenSection: (project: LearningProject, chapterId: string, sectionId: string) => void;
  onEditOutline: (project: LearningProject) => void;
  onBack: () => void;
}) {
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

  return (
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
  );
}

function ClassroomPage({
  project,
  chapter,
  section,
  onBack,
  onOpenSection,
  onProjectUpdate,
}: {
  project: LearningProject;
  chapter: CourseChapter;
  section: LessonSection;
  onBack: () => void;
  onOpenSection: (project: LearningProject, chapterId: string, sectionId: string) => void;
  onProjectUpdate: (project: LearningProject) => void;
}) {
  const { notify } = useToast();
  type LearningPhase = "orient" | "understand" | "practice" | "reflect";
  type PracticeResult = "idle" | "correct" | "incorrect";
  type Confidence = "uncertain" | "partial" | "ready";

  const phaseItems: Array<{
    id: LearningPhase;
    index: string;
    label: string;
    description: string;
  }> = [
    { id: "orient", index: "01", label: "定位", description: "先看知识关系" },
    { id: "understand", index: "02", label: "理解", description: "弄懂核心机制" },
    { id: "practice", index: "03", label: "应用", description: "用一次才算数" },
    { id: "reflect", index: "04", label: "回顾", description: "看看学会了什么" },
  ];
  const [content, setContent] = useState<LessonContent | null>(
    section.content ?? null,
  );
  const [isGenerating, setIsGenerating] = useState(!section.content);
  const [generationError, setGenerationError] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);
  const [tutorInput, setTutorInput] = useState("");
  const [isTutorThinking, setIsTutorThinking] = useState(false);
  const [activePhase, setActivePhase] = useState<LearningPhase>("orient");
  const [isCourseMapOpen, setIsCourseMapOpen] = useState(false);
  const [isCoachOpen, setIsCoachOpen] = useState(true);
  const [visitedPhases, setVisitedPhases] = useState<LearningPhase[]>(["orient"]);
  const [understandingComplete, setUnderstandingComplete] = useState(false);
  const [practiceResolved, setPracticeResolved] = useState(false);
  const [progressSaveState, setProgressSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [practiceResult, setPracticeResult] = useState<PracticeResult>("idle");
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [reflectionText, setReflectionText] = useState(
    section.learningProgress?.reflection?.summary ?? "",
  );
  const [reflectionFeedback, setReflectionFeedback] = useState(
    section.learningProgress?.reflection?.tutorFeedback ?? "",
  );
  const [isCheckingReflection, setIsCheckingReflection] = useState(false);
  const [agentSuggestions, setAgentSuggestions] = useState<string[]>([]);
  const [coachRecommendation, setCoachRecommendation] = useState("");
  const [tutorMessages, setTutorMessages] = useState<
    Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      error?: boolean;
    }>
  >([]);
  const lessonRequestId = useRef(0);
  const latestProgressRef = useRef<LessonProgress | undefined>(
    section.learningProgress,
  );
  const progressSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const chatThreadRef = useRef<HTMLDivElement>(null);

  const sectionPositions = useMemo(
    () =>
      project.chapters.flatMap((currentChapter) =>
        currentChapter.sections.map((currentSection) => ({
          chapterId: currentChapter.id,
          sectionId: currentSection.id,
        })),
      ),
    [project.chapters],
  );
  const currentSectionIndex = sectionPositions.findIndex(
    (item) => item.sectionId === section.id,
  );
  const completedSectionCount = project.chapters.reduce(
    (total, currentChapter) =>
      total +
      currentChapter.sections.filter(
        (currentSection) => currentSection.status === "done",
      ).length,
    0,
  );
  const previousSection =
    currentSectionIndex > 0 ? sectionPositions[currentSectionIndex - 1] : null;
  const nextSection =
    currentSectionIndex >= 0 &&
    currentSectionIndex < sectionPositions.length - 1
      ? sectionPositions[currentSectionIndex + 1]
      : null;
  const lessonSourceRefs = new Set(
    content?.research?.sourceRefs ?? section.sourceRefs ?? [],
  );
  const lessonSources = (project.sources ?? []).filter((source) =>
    lessonSourceRefs.has(source.url),
  );
  const understandingScenes = useMemo(
    () => (content ? getUnderstandingScenes(content) : []),
    [content],
  );
  const knowledgeRecords = Object.values(
    section.learningProgress?.knowledge ?? {},
  );
  const weakestKnowledge = knowledgeRecords.reduce<
    LessonKnowledgeState | undefined
  >(
    (weakest, item) =>
      !weakest || item.mastery < weakest.mastery ? item : weakest,
    undefined,
  );
  const completedUnderstandingCount =
    section.learningProgress?.completedSceneIds.length ?? 0;
  const totalUnderstandingHints = Object.values(
    section.learningProgress?.evidence ?? {},
  ).reduce((sum, item) => sum + item.hintsUsed, 0);
  const reflectionEvidenceCount =
    Number(understandingComplete) +
    Number(practiceResolved) +
    Number(reflectionText.trim().length >= 8);
  const nextReviewLabel = weakestKnowledge?.nextReviewAt
    ? new Date(weakestKnowledge.nextReviewAt).toLocaleDateString("zh-CN", {
        month: "short",
        day: "numeric",
      })
    : "完成后生成";
  const activePhaseIndex = phaseItems.findIndex((item) => item.id === activePhase);
  const phaseProgress = Math.round(
    ((Math.max(activePhaseIndex, 0) + 1) / phaseItems.length) * 100,
  );
  const quickPrompts = agentSuggestions.length
    ? agentSuggestions
    : activePhase === "orient"
      ? ["这张知识图怎么读", "本节最重要的关系是什么", "先修知识有哪些"]
      : activePhase === "understand"
        ? ["再讲简单点", "换一个生活类比", "检查我的理解"]
        : activePhase === "practice"
          ? practiceResult === "idle"
            ? ["给我一级提示", "帮我排除一个选项", "提醒我用哪个概念"]
            : ["分析我的思路", "给我一道变式题", "让我解释为什么"]
          : ["用三个问题检验我", "总结我的薄弱点", "安排一次复习"];
  const defaultRecommendation =
    practiceResult === "incorrect"
      ? "先弄清刚才容易混淆的地方，再试一道类似的题。"
      : practiceResult === "correct" && !confidence
        ? "这道题答对了。试着用自己的话说说为什么。"
        : activePhase === "orient"
          ? "先花两分钟看看这些知识之间有什么关系。"
          : activePhase === "understand"
            ? weakestKnowledge?.lastOutcome === "needs-review"
              ? `先用一个新例子重新判断“${weakestKnowledge.label}”，确认刚才的误区已经修正。`
              : "看完例子后，先不看讲解，自己试一次。"
            : activePhase === "practice"
              ? "先自己作答；实在卡住了，再要一个提示。"
              : confidence
                ? "这一节的重点已经基本掌握。之后再用一道新题巩固一下。"
                : "想一想，如果换个场景，你现在还会不会用。";
  const coachSignal =
    practiceResult === "incorrect"
      ? "这里有一个容易混淆的地方"
      : practiceResult === "correct"
        ? "这道题答对了"
        : weakestKnowledge?.lastOutcome === "needs-review"
          ? `“${weakestKnowledge.label}”还需要再验证一次`
        : activePhase === "practice"
          ? "正在等待你的独立作答"
          : `现在进行到「${phaseItems[activePhaseIndex]?.label ?? "学习"}」`;

  function openPhase(phase: LearningPhase) {
    setActivePhase(phase);
    setVisitedPhases((current) =>
      current.includes(phase) ? current : [...current, phase],
    );
    setAgentSuggestions([]);
  }

  function advancePhase() {
    const nextPhase = phaseItems[activePhaseIndex + 1]?.id;
    if (nextPhase) openPhase(nextPhase);
  }

  function persistLessonProgress(progress: LessonProgress) {
    latestProgressRef.current = progress;
    setProgressSaveState("saving");
    progressSaveQueue.current = progressSaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const result = await saveRemoteLessonProgress(
          project.id,
          section.id,
          progress,
        );
        onProjectUpdate(result.project);
        setProgressSaveState("saved");
      })
      .catch(() => {
        setProgressSaveState("error");
      });
  }

  useEffect(() => {
    const requestId = ++lessonRequestId.current;
    setContent(section.content ?? null);
    setGenerationError("");
    setTutorInput("");
    setActivePhase("orient");
    setVisitedPhases(["orient"]);
    setUnderstandingComplete(false);
    setProgressSaveState("idle");
    setPracticeResult("idle");
    setPracticeResolved(false);
    setConfidence(section.learningProgress?.reflection?.confidence ?? null);
    setReflectionText(section.learningProgress?.reflection?.summary ?? "");
    setReflectionFeedback(
      section.learningProgress?.reflection?.tutorFeedback ?? "",
    );
    setIsCheckingReflection(false);
    latestProgressRef.current = section.learningProgress;
    setAgentSuggestions([]);
    setCoachRecommendation("");
    setTutorMessages([
      {
        id: `intro-${section.id}`,
        role: "assistant",
        content: `我会陪你学完《${section.title}》。有不明白的地方随时问我，我们先看看这一节讲什么。`,
      },
    ]);

    if (section.content) {
      setIsGenerating(false);
      return () => {
        lessonRequestId.current += 1;
      };
    }

    setIsGenerating(true);
    generateRemoteLesson(project.id, section.id)
      .then((result) => {
        if (lessonRequestId.current !== requestId) return;
        setContent(result.content);
        setIsGenerating(false);
        onProjectUpdate(result.project);
      })
      .catch((error) => {
        if (lessonRequestId.current !== requestId) return;
        setGenerationError(getErrorMessage(error));
        setIsGenerating(false);
      });

    return () => {
      lessonRequestId.current += 1;
    };
  }, [project.id, section.id]);

  useEffect(() => {
    if (!understandingScenes.length) return;
    const completedSceneIds = new Set(
      section.learningProgress?.completedSceneIds ?? [],
    );
    setUnderstandingComplete(
      understandingScenes.every((scene) => completedSceneIds.has(scene.id)),
    );
  }, [
    section.id,
    section.learningProgress?.updatedAt,
    understandingScenes,
  ]);

  useEffect(() => {
    const thread = chatThreadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [tutorMessages, isTutorThinking]);

  useEffect(() => {
    if (!isCourseMapOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCourseMapOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isCourseMapOpen]);

  async function regenerateLesson() {
    if (isGenerating) return;
    const requestId = ++lessonRequestId.current;
    setIsGenerating(true);
    setGenerationError("");
    try {
      const result = await generateRemoteLesson(project.id, section.id, true);
      if (lessonRequestId.current !== requestId) return;
      setContent(result.content);
      onProjectUpdate(result.project);
      notify({
        variant: "success",
        title: "本节内容已更新",
        description: "讲解、示例和练习已换成最新整理的版本。",
      });
    } catch (error) {
      if (lessonRequestId.current !== requestId) return;
      const message = getErrorMessage(error);
      setGenerationError(message);
      notify({
        variant: "error",
        title: content ? "这次没有更新成功" : "本节内容准备失败",
        description: content ? `原内容仍然保留。${message}` : message,
      });
    } finally {
      if (lessonRequestId.current === requestId) setIsGenerating(false);
    }
  }

  async function sendTutorMessage(
    preset?: string,
    sceneContext?: TutorSceneContext,
  ) {
    const message = (preset ?? tutorInput).trim();
    if (!message || isTutorThinking) return;

    const history: TutorHistoryItem[] = tutorMessages
      .filter((item) => !item.error)
      .slice(-8)
      .map(({ role, content: messageContent }) => ({
        role,
        content: messageContent,
      }));
    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user" as const,
      content: message,
    };
    setTutorMessages((current) => [...current, userMessage]);
    setTutorInput("");
    setIsTutorThinking(true);

    try {
      const result = await askRemoteTutor(
        project.id,
        section.id,
        message,
        history,
        {
          phase: activePhase,
          attempt:
            sceneContext?.correct === false
              ? "incorrect"
              : sceneContext?.correct === true
                ? "correct"
                : practiceResult,
          confidence,
          ...(sceneContext ? { scene: sceneContext } : {}),
        },
      );
      setTutorMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: result.answer,
        },
      ]);
      setAgentSuggestions(result.suggestions);
      setCoachRecommendation(result.recommendedAction ?? "");
      return result.answer;
    } catch (error) {
      setTutorMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: getErrorMessage(error),
          error: true,
        },
      ]);
    } finally {
      setIsTutorThinking(false);
    }
    return undefined;
  }

  function persistReflection(
    nextConfidence: Confidence,
    summary = reflectionText,
    tutorFeedback = reflectionFeedback,
  ) {
    const now = new Date().toISOString();
    const currentProgress = latestProgressRef.current ?? {
      schemaVersion: 1 as const,
      completedSceneIds: [],
      evidence: {},
      updatedAt: now,
    };
    persistLessonProgress({
      ...currentProgress,
      reflection: {
        summary: summary.trim().slice(0, 1200),
        confidence: nextConfidence,
        ...(tutorFeedback.trim()
          ? { tutorFeedback: tutorFeedback.trim().slice(0, 4000) }
          : {}),
        updatedAt: now,
      },
      updatedAt: now,
    });
  }

  function chooseConfidence(nextConfidence: Confidence) {
    setConfidence(nextConfidence);
    persistReflection(nextConfidence);
  }

  async function checkReflection() {
    const summary = reflectionText.trim();
    if (summary.length < 8 || isCheckingReflection) return;
    setIsCheckingReflection(true);
    try {
      const history: TutorHistoryItem[] = tutorMessages
        .filter((item) => !item.error)
        .slice(-6)
        .map(({ role, content: messageContent }) => ({
          role,
          content: messageContent,
        }));
      const result = await askRemoteTutor(
        project.id,
        section.id,
        `我用一句话总结本节：“${summary}”。请只检查这句话是否抓住了本节最核心的关系：先指出说对的部分，再指出最需要补充的一点。不要继续讲后面的内容。`,
        history,
        {
          phase: "reflect",
          attempt: practiceResult,
          confidence,
        },
      );
      setReflectionFeedback(result.answer);
      setAgentSuggestions(result.suggestions);
      setCoachRecommendation(result.recommendedAction ?? "");
      if (confidence) {
        persistReflection(confidence, summary, result.answer);
      }
    } catch (error) {
      notify({
        variant: "error",
        title: "这句话暂时没有检查成功",
        description: getErrorMessage(error),
      });
    } finally {
      setIsCheckingReflection(false);
    }
  }

  async function markSectionComplete() {
    if (isCompleting || section.status === "done") return;
    setIsCompleting(true);
    try {
      await progressSaveQueue.current;
      const result = await completeRemoteSection(project.id, section.id);
      onProjectUpdate(result.project);
      notify({
        variant: "success",
        title: "本节已完成",
        description: result.next ? "下一节已解锁，可以继续学习。" : "课程小节已全部完成。",
      });
    } catch (error) {
      notify({
        variant: "error",
        title: "学习进度保存失败",
        description: getErrorMessage(error),
      });
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <main className="classroom-page">
      <section className="classroom-top classroom-top--v3">
        <div className="classroom-top-primary">
          <button
            className="classroom-map-toggle"
            aria-controls="classroom-course-map"
            aria-expanded={isCourseMapOpen}
            onClick={() => setIsCourseMapOpen(true)}
          >
            <i aria-hidden="true">☰</i>
            <span>课程地图</span>
          </button>
          <button className="icon-button" onClick={onBack} aria-label="返回">←</button>
          <div className="classroom-breadcrumb">
            <span>{project.title}</span>
            <strong>{chapter.title} · {section.title}</strong>
          </div>
        </div>
        <div className="classroom-top-actions">
          <div className="lesson-generation-meta">
            <i className={isGenerating ? "is-working" : ""} />
            <span>
              {isGenerating
                ? "正在整理本节"
                : lessonSources.length
                  ? `${lessonSources.length} 项参考资料`
                  : content && !content.research
                    ? "资料待补充"
                    : content
                      ? "内容已准备"
                      : "内容待准备"}
            </span>
          </div>
          <div className="classroom-step-status">
            <span>当前步骤</span>
            <strong>{String(activePhaseIndex + 1).padStart(2, "0")} / 04</strong>
          </div>
          <button
            className={`classroom-coach-toggle ${isCoachOpen ? "is-active" : ""}`}
            aria-controls="classroom-coach"
            aria-expanded={isCoachOpen}
            onClick={() => setIsCoachOpen((current) => !current)}
          >
            {isCoachOpen ? "收起助教" : "打开助教"}
          </button>
        </div>
      </section>

      <button
        className={`course-drawer-backdrop ${isCourseMapOpen ? "is-open" : ""}`}
        aria-label="关闭课程地图"
        tabIndex={isCourseMapOpen ? 0 : -1}
        onClick={() => setIsCourseMapOpen(false)}
      />
      <aside
        className={`course-drawer course-drawer--v3 ${isCourseMapOpen ? "is-open" : ""}`}
        id="classroom-course-map"
        aria-hidden={!isCourseMapOpen}
        inert={!isCourseMapOpen}
      >
        <header className="course-drawer-header">
          <div>
            <span>COURSE MAP</span>
            <h2>课程地图</h2>
            <p>{completedSectionCount}/{sectionPositions.length} 节已完成</p>
          </div>
          <button
            className="icon-button"
            aria-label="关闭课程地图"
            onClick={() => setIsCourseMapOpen(false)}
          >
            ×
          </button>
        </header>
        <div className="course-drawer-progress">
          <i>
            <b
              style={{
                width: `${sectionPositions.length ? Math.round((completedSectionCount / sectionPositions.length) * 100) : 0}%`,
              }}
            />
          </i>
          <span>当前位于第 {Math.max(currentSectionIndex + 1, 1)} 节</span>
        </div>
        <div className="course-drawer-scroll">
          <CourseTree
            project={project}
            onOpenSection={(nextProject, chapterId, sectionId) => {
              setIsCourseMapOpen(false);
              onOpenSection(nextProject, chapterId, sectionId);
            }}
          />
        </div>
      </aside>

      <div
        className={`classroom-layout classroom-layout--v3 ${isCoachOpen ? "" : "is-coach-closed"}`}
      >
        <section className="lesson-content">
          <section className="lesson-mission">
            <div>
              <span className="mission-kicker">
                第 {Math.max(currentSectionIndex + 1, 1)} 节 · 本节任务
              </span>
              <h1>{section.title}</h1>
              <p>{section.outcome ?? content?.overview ?? "理解本节核心机制，并能在一个真实问题中正确应用。"}</p>
              {content?.learningDesign ? (
                <div className="lesson-strategy-summary">
                  <span>
                    <small>为什么现在学</small>
                    <strong>{content.learningDesign.whyNow}</strong>
                  </span>
                  <span>
                    <small>学会的证据</small>
                    <strong>{content.learningDesign.successCriteria[0]}</strong>
                  </span>
                </div>
              ) : section.strategy?.whyNow ? (
                <div className="lesson-strategy-summary">
                  <span>
                    <small>为什么现在学</small>
                    <strong>{section.strategy.whyNow}</strong>
                  </span>
                </div>
              ) : null}
              {lessonSources.length ? (
                <details className="lesson-sources">
                  <summary>参考资料 {lessonSources.length} 项</summary>
                  <div>
                    {lessonSources.map((source) => (
                      <a
                        href={source.url}
                        key={source.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <strong>{source.title}</strong>
                        <span>{getSourceHost(source.url)}</span>
                      </a>
                    ))}
                  </div>
                </details>
              ) : content?.research?.warning ? (
                <span className="lesson-source-note">
                  本节暂时没有找到合适的外部资料，涉及版本和配置的内容请留意。
                </span>
              ) : content && !content.research ? (
                <span className="lesson-source-note">
                  这节内容还没有关联参考资料，可以检查并更新。
                </span>
              ) : null}
            </div>
            <div className="lesson-mission-actions">
              <div className="lesson-mission-meta">
                <span>
                  <small>学习路径</small>
                  <strong>4 步</strong>
                </span>
                <span>
                  <small>当前进度</small>
                  <strong>{phaseProgress}%</strong>
                </span>
              </div>
              <button
                className="soft-pill"
                disabled={isGenerating}
                onClick={regenerateLesson}
              >
                {isGenerating ? "正在准备…" : content ? "检查内容更新" : "准备本节内容"}
              </button>
            </div>
          </section>

          <nav className="learning-route" aria-label="本节学习步骤">
            {phaseItems.map((phase, index) => {
              const isActive = phase.id === activePhase;
              const isVisited = visitedPhases.includes(phase.id);
              return (
                <button
                  className={[
                    "learning-route-step",
                    isActive ? "is-active" : "",
                    isVisited ? "is-visited" : "",
                  ].join(" ")}
                  aria-current={isActive ? "step" : undefined}
                  key={phase.id}
                  onClick={() => openPhase(phase.id)}
                >
                  <span>{isVisited && !isActive ? "✓" : phase.index}</span>
                  <span>
                    <strong>{phase.label}</strong>
                    <small>{phase.description}</small>
                  </span>
                  {index < phaseItems.length - 1 ? <i /> : null}
                </button>
              );
            })}
          </nav>

          {isGenerating && !content ? (
            <section className="lesson-generation-state" aria-live="polite">
              <div className="generation-orbit">
                <span />
                <i />
              </div>
              <div>
                <p>正在准备</p>
                <h2>正在整理这一节的内容</h2>
                <span>检查参考资料 · 梳理知识关系 · 准备讲解 · 安排练习</span>
              </div>
            </section>
          ) : null}

          {!isGenerating && generationError && !content ? (
            <section className="lesson-error-state" role="alert">
              <span>!</span>
              <div>
                <strong>本节内容还没有准备好</strong>
                <p>{generationError}</p>
              </div>
              <button className="primary-pill" onClick={regenerateLesson}>
                再试一次
              </button>
            </section>
          ) : null}

          {!isGenerating && generationError && content ? (
            <section className="lesson-update-warning" role="status">
              <span>!</span>
              <div>
                <strong>这次没有更新成功，仍在使用原内容</strong>
                <p>{generationError}</p>
              </div>
              <button className="soft-pill" onClick={regenerateLesson}>
                再试一次
              </button>
            </section>
          ) : null}

          {content ? (
            <>
              {activePhase === "orient" ? (
                <section className="learning-stage learning-stage--orient">
                  <div className="stage-intro">
                    <span>01 · 定位本节</span>
                    <h2>先建立一张可用的知识地图</h2>
                    <p>{content.overview}</p>
                  </div>
                  {content.learningDesign ? (
                    <section
                      className="lesson-design-brief"
                      aria-label="本节学习定位"
                    >
                      <article>
                        <small>现在学它</small>
                        <strong>{content.learningDesign.whyNow}</strong>
                      </article>
                      <article>
                        <small>后面会用到</small>
                        <ul>
                          {content.learningDesign.futureUses
                            .slice(0, 3)
                            .map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                        </ul>
                      </article>
                      <article>
                        <small>真正的难点</small>
                        <ul>
                          {content.learningDesign.difficultyFocus
                            .slice(0, 3)
                            .map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                        </ul>
                      </article>
                    </section>
                  ) : null}
                  <div className="orient-knowledge-map">
                    <section className="orient-core-card">
                      <div>
                        <small>本节围绕</small>
                        <h3>{content.mindMap.center}</h3>
                        <p>
                          先看清这些关系怎样共同回答本节问题，不需要现在记住全部细节。
                        </p>
                      </div>
                      <div className="orient-map-meta">
                        <span>
                          <strong>{content.mindMap.branches.length}</strong>
                          条知识关系
                        </span>
                        <span>
                          <strong>{understandingScenes.length}</strong>
                          个互动场景
                        </span>
                      </div>
                      <div className="orient-route-line" aria-label="建议阅读顺序">
                        {content.mindMap.branches.map((branch, branchIndex) => (
                          <span key={`${branch.title}-route-${branchIndex}`}>
                            {String(branchIndex + 1).padStart(2, "0")}
                          </span>
                        ))}
                      </div>
                    </section>
                    <div className="orient-branches">
                      {content.mindMap.branches.map((branch, branchIndex) => (
                        <article key={`${branch.title}-${branchIndex}`}>
                          <header>
                            <span>
                              {String(branchIndex + 1).padStart(2, "0")}
                            </span>
                            <strong>{branch.title}</strong>
                          </header>
                          <ul>
                            {branch.details.map((detail, detailIndex) => (
                              <li key={`${detail}-${detailIndex}`}>
                                <i />
                                <span>{detail}</span>
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  </div>
                  <section className="orient-handoff">
                    <div>
                      <small>接下来</small>
                      <strong>先判断，再按你的回答展开</strong>
                      <p>
                        已经掌握的会快速通过，容易混淆的地方会多停一步。
                      </p>
                    </div>
                    <button
                      className="stage-primary-action"
                      onClick={advancePhase}
                    >
                      从第一个判断开始 <span>→</span>
                    </button>
                  </section>
                </section>
              ) : null}

              {activePhase === "understand" ? (
                <section className="learning-stage learning-stage--understand">
                  <div className="stage-intro">
                    <span>02 · 弄明白</span>
                    <h2>一次只解决一个问题</h2>
                    <p>先判断，再逐步展开。你的每次选择都会决定这一幕该怎样解释。</p>
                  </div>
                  <LessonSceneFlow
                    initialProgress={section.learningProgress}
                    scenes={understandingScenes}
                    sectionId={section.id}
                    onAskTutor={(message, sceneContext) =>
                      sendTutorMessage(message, sceneContext)
                    }
                    onComplete={() => setUnderstandingComplete(true)}
                    onProgressChange={persistLessonProgress}
                    progressSaveState={progressSaveState}
                  />
                  {content.learningDesign?.methodPaths.length ? (
                    <section className="lesson-method-paths">
                      <header>
                        <span>方法不是口诀</span>
                        <h3>选哪条路，取决于条件</h3>
                        <p>每种方法都带着适用场景和边界，不把技巧当成万能答案。</p>
                      </header>
                      <div>
                        {content.learningDesign.methodPaths.map(
                          (method, methodIndex) => (
                            <article key={`${method.name}-${methodIndex}`}>
                              <span>
                                {String(methodIndex + 1).padStart(2, "0")}
                              </span>
                              <h4>{method.name}</h4>
                              <dl>
                                <div>
                                  <dt>为什么有效</dt>
                                  <dd>{method.principle}</dd>
                                </div>
                                <div>
                                  <dt>适合</dt>
                                  <dd>{method.bestFor}</dd>
                                </div>
                                <div>
                                  <dt>边界</dt>
                                  <dd>{method.boundary}</dd>
                                </div>
                              </dl>
                            </article>
                          ),
                        )}
                      </div>
                    </section>
                  ) : null}
                  <details className="lesson-reference-notes">
                    <summary>需要时查看完整讲解</summary>
                    <div>
                      <p>{content.explanation.lead}</p>
                      {content.explanation.paragraphs.map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                      ))}
                    </div>
                  </details>
                  {understandingComplete ? (
                    <button className="stage-primary-action" onClick={advancePhase}>
                      带着刚才的判断去做一次 <span>→</span>
                    </button>
                  ) : null}
                </section>
              ) : null}

              {activePhase === "practice" ? (
                <section className="learning-stage">
                  <div className="stage-intro">
                    <span>03 · 动手试试</span>
                    <h2>现在不看答案，独立做一次</h2>
                    <p>
                      {content.learningDesign?.successCriteria[0]
                        ? `这一题先验证：${content.learningDesign.successCriteria[0]}`
                        : "这道题可以帮你看看是否真的理解了。"}
                      卡住时可以要一个提示，但不会直接显示答案。
                    </p>
                  </div>
                  <PracticeCard
                    exercise={content.exercise}
                    sectionId={section.id}
                    onAskForHint={(level) =>
                      sendTutorMessage(
                        `请根据当前练习题给我第 ${level} 级提示，只缩小判断范围，不要公布正确选项。`,
                      )
                    }
                    onResult={({ correct, resolved }) => {
                      setPracticeResult(correct ? "correct" : "incorrect");
                      setPracticeResolved(resolved);
                      setCoachRecommendation("");
                      setAgentSuggestions([]);
                    }}
                    onRetry={() => {
                      setPracticeResult("idle");
                      setPracticeResolved(false);
                    }}
                  />
                  {practiceResolved ? (
                    <button className="stage-primary-action" onClick={advancePhase}>
                      看看学得怎么样 <span>→</span>
                    </button>
                  ) : null}
                </section>
              ) : null}

              {activePhase === "reflect" ? (
                <section className="learning-stage learning-stage--reflect">
                  <div className="stage-intro">
                    <span>04 · 收束本节</span>
                    <h2>把学会的留下，把不稳的排进复习</h2>
                    <p>先看刚才留下的学习证据，再判断这一节是否真的可以结束。</p>
                  </div>

                  {content.learningDesign?.successCriteria.length ? (
                    <section className="lesson-success-criteria">
                      <span>本节完成标准</span>
                      <div>
                        {content.learningDesign.successCriteria.map(
                          (criterion, criterionIndex) => (
                            <p key={criterion}>
                              <i>{String(criterionIndex + 1).padStart(2, "0")}</i>
                              {criterion}
                            </p>
                          ),
                        )}
                      </div>
                    </section>
                  ) : null}

                  <div className="reflect-summary">
                    <article className="reflect-score-card">
                      <span>本节学习证据</span>
                      <div>
                        <strong>{reflectionEvidenceCount}</strong>
                        <small>/ 3 项</small>
                      </div>
                      <p>
                        {reflectionEvidenceCount === 3
                          ? "理解、应用和复述都已留下记录"
                          : "继续完成下方步骤，补齐本节记录"}
                      </p>
                      <i>
                        <b
                          style={{
                            width: `${Math.round((reflectionEvidenceCount / 3) * 100)}%`,
                          }}
                        />
                      </i>
                    </article>

                    <div className="reflect-evidence-list">
                      <article className={understandingComplete ? "is-earned" : ""}>
                        <span>01</span>
                        <div>
                          <small>理解路径</small>
                          <strong>
                            完成 {completedUnderstandingCount}/{understandingScenes.length} 幕
                          </strong>
                          <p>
                            {totalUnderstandingHints
                              ? `过程中使用了 ${totalUnderstandingHints} 次提示`
                              : "主要依靠自己的判断推进"}
                          </p>
                        </div>
                      </article>
                      <article
                        className={
                          practiceResult === "correct"
                            ? "is-earned"
                            : practiceResult === "incorrect"
                              ? "is-weak"
                              : ""
                        }
                      >
                        <span>02</span>
                        <div>
                          <small>独立应用</small>
                          <strong>
                            {practiceResult === "correct"
                              ? "已独立完成"
                              : practiceResult === "incorrect"
                                ? "已经尝试，但还没通过"
                                : "尚未留下作答证据"}
                          </strong>
                          <p>
                            {practiceResult === "correct"
                              ? "答案与关键判断都已核对"
                              : "完成当前练习后再结束本节"}
                          </p>
                        </div>
                      </article>
                      <article
                        className={
                          weakestKnowledge?.lastOutcome === "needs-review"
                            ? "is-weak"
                            : "is-earned"
                        }
                      >
                        <span>03</span>
                        <div>
                          <small>需要留意</small>
                          <strong>{weakestKnowledge?.label ?? "换个场景再判断一次"}</strong>
                          <p>
                            {weakestKnowledge
                              ? `当前掌握度约 ${Math.round(weakestKnowledge.mastery * 100)}%，建议 ${nextReviewLabel} 再验证`
                              : "完成本节后会安排下一次回看"}
                          </p>
                        </div>
                      </article>
                    </div>
                  </div>

                  <section className="reflect-teach-back">
                    <header>
                      <div>
                        <span>用一句话讲回来</span>
                        <h3>不看页面，写下本节最核心的关系</h3>
                      </div>
                      <small>{reflectionText.trim().length}/1200</small>
                    </header>
                    <textarea
                      value={reflectionText}
                      maxLength={1200}
                      placeholder={`例如：${content.mindMap.center}最重要的不是记住定义，而是……`}
                      onBlur={() => {
                        if (confidence) persistReflection(confidence);
                      }}
                      onChange={(event) => {
                        setReflectionText(event.target.value);
                        if (reflectionFeedback) setReflectionFeedback("");
                      }}
                    />
                    <footer>
                      <p>
                        {reflectionText.trim().length < 8
                          ? "至少写清一个概念与另一个概念之间的关系。"
                          : "助教只会检查这句话，不会替你继续讲后面的内容。"}
                      </p>
                      <button
                        className="soft-pill"
                        disabled={
                          reflectionText.trim().length < 8 ||
                          isCheckingReflection ||
                          isTutorThinking
                        }
                        onClick={checkReflection}
                      >
                        {isCheckingReflection
                          ? "正在检查…"
                          : reflectionFeedback
                            ? "重新检查"
                            : "检查这句话"}
                      </button>
                    </footer>
                    {reflectionFeedback ? (
                      <div className="reflect-feedback">
                        <span>检查结果</span>
                        <p>{reflectionFeedback}</p>
                      </div>
                    ) : null}
                  </section>

                  <div className="confidence-check confidence-check--calibrated">
                    <div>
                      <span>最后做一次校准</span>
                      <h3>结合上面的证据，你现在处于哪种状态？</h3>
                      <p>这里没有“高分选项”，只决定下一次什么时候回来复习。</p>
                    </div>
                    <div className="confidence-options">
                      {[
                        { id: "uncertain" as const, label: "还不稳", note: "尽快再讲一次" },
                        { id: "partial" as const, label: "基本会了", note: "过几天再验证" },
                        { id: "ready" as const, label: "可以迁移", note: "下次直接做新题" },
                      ].map((option) => (
                        <button
                          className={confidence === option.id ? "is-selected" : ""}
                          key={option.id}
                          onClick={() => chooseConfidence(option.id)}
                        >
                          <strong>{option.label}</strong>
                          <small>{option.note}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="completion-decision completion-decision--review">
                    <div>
                      <span
                        className={
                          practiceResolved && confidence
                            ? "decision-dot is-ready"
                            : "decision-dot"
                        }
                      />
                      <div>
                        <strong>
                          {!practiceResolved
                            ? "建议先完成当前练习"
                            : reflectionText.trim().length < 8
                              ? "再用一句话讲回本节核心"
                            : !confidence
                              ? "再选一个符合当前状态的判断"
                              : confidence === "uncertain"
                                ? "可以先保存，本节会进入近期复习"
                                : "证据已记录，可以结束这一节"}
                        </strong>
                        <p>
                          {confidence
                            ? `下一次建议回看：${nextReviewLabel}`
                            : "你的选择会影响下一次复习时间，不影响完成记录。"}
                        </p>
                      </div>
                    </div>
                    <button
                      className="primary-pill"
                      disabled={
                        isCompleting ||
                        !practiceResolved ||
                        practiceResult === "idle" ||
                        reflectionText.trim().length < 8 ||
                        !confidence ||
                        section.status === "done"
                      }
                      onClick={markSectionComplete}
                    >
                      {section.status === "done"
                        ? "本节已完成"
                        : isCompleting
                          ? "保存中…"
                          : "保存本节并安排复习"}
                    </button>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          <nav className="lesson-nav" aria-label="课堂导航">
            <button
              disabled={!previousSection}
              onClick={() =>
                previousSection &&
                onOpenSection(
                  project,
                  previousSection.chapterId,
                  previousSection.sectionId,
                )
              }
            >
              <span>上一节</span>
              <small>课程</small>
            </button>
            <button
              disabled={activePhaseIndex <= 0}
              onClick={() => {
                const previousPhase = phaseItems[activePhaseIndex - 1]?.id;
                if (previousPhase) openPhase(previousPhase);
              }}
            >
              <span>上一步</span>
              <small>本节路径</small>
            </button>
            <button
              className="is-primary"
              disabled={activePhase === "reflect" || isGenerating || !content}
              onClick={advancePhase}
            >
              <span>{activePhase === "reflect" ? "本节回顾" : "继续学习"}</span>
              <small>
                {activePhase === "reflect"
                  ? "完成后进入下一节"
                  : phaseItems[activePhaseIndex + 1]?.label ?? "下一步"}
              </small>
            </button>
            <button
              disabled={!nextSection || section.status !== "done"}
              onClick={() =>
                nextSection &&
                onOpenSection(
                  project,
                  nextSection.chapterId,
                  nextSection.sectionId,
                )
              }
            >
              <span>下一节</span>
              <small>课程</small>
            </button>
          </nav>
        </section>

        {isCoachOpen ? (
        <aside className="ai-chat ai-coach ai-coach--v3" id="classroom-coach">
          <div className="ai-chat-heading ai-chat-heading--v3">
            <div className="coach-title">
              <div>
                <span className="ai-status-dot" />
                <p>跟随本节进度</p>
              </div>
              <h2>随堂助教</h2>
            </div>
            <button
              className="icon-button"
              aria-label="收起助教"
              onClick={() => setIsCoachOpen(false)}
            >
              ×
            </button>
          </div>
          <section className="coach-readout">
            <div
              className="mastery-ring"
              style={{ "--mastery": `${phaseProgress}%` } as CSSProperties}
            >
              <span>{String(activePhaseIndex + 1).padStart(2, "0")}</span>
              <small>/ 04 步</small>
            </div>
            <div>
              <small>{phaseItems[activePhaseIndex]?.label ?? "当前"}</small>
              <strong>{coachSignal}</strong>
            </div>
          </section>
          <div className="coach-evidence">
            <span className={understandingComplete ? "is-earned" : ""}>
              <i /> 已理解
            </span>
            <span className={practiceResolved ? (practiceResult === "correct" ? "is-earned" : "is-weak") : ""}>
              <i /> 已练习
            </span>
            <span className={reflectionText.trim().length >= 8 ? "is-earned" : ""}>
              <i /> 已复述
            </span>
          </div>
          <section className="coach-next-action">
            <span>接下来</span>
            <p>{coachRecommendation || defaultRecommendation}</p>
          </section>
          <div className="coach-divider">
            <span>需要帮助？</span>
          </div>
          <div className="prompt-chips">
            {quickPrompts.map((prompt) => (
              <button
                disabled={isTutorThinking}
                key={prompt}
                onClick={() => sendTutorMessage(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          <div className="chat-thread" ref={chatThreadRef} aria-live="polite">
            {tutorMessages.map((message) => (
              <div
                className={`chat-message chat-message--${message.role} ${message.error ? "chat-message--error" : ""}`}
                key={message.id}
              >
                <small>{message.role === "assistant" ? "助教" : "你"}</small>
                <p>{message.content}</p>
              </div>
            ))}
            {isTutorThinking ? (
              <div className="chat-message chat-message--assistant">
                <small>助教</small>
                <div className="thinking-dots" aria-label="正在回复">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ) : null}
          </div>
          <div className="chat-input">
            <textarea
              value={tutorInput}
              maxLength={2000}
              rows={2}
              placeholder="围绕本节继续追问…"
              onChange={(event) => setTutorInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendTutorMessage();
                }
              }}
            />
            <button
              disabled={isTutorThinking || !tutorInput.trim()}
              onClick={() => sendTutorMessage()}
            >
              发送
            </button>
          </div>
        </aside>
        ) : null}
      </div>
    </main>
  );
}

function SettingsPage({
  settings,
  onSave,
  onCancel,
}: {
  settings: ModelSettings;
  onSave: (settings: ModelSettings) => Promise<void>;
  onCancel: () => void;
}) {
  const { notify } = useToast();
  const [draft, setDraft] = useState(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingSearch, setIsTestingSearch] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyPersisted, setApiKeyPersisted] = useState(false);
  const [searchKeyConfigured, setSearchKeyConfigured] = useState(false);
  const [searchKeyPersisted, setSearchKeyPersisted] = useState(false);
  const [models, setModels] = useState<RemoteModel[]>([]);
  const [modelLoadError, setModelLoadError] = useState("");

  useEffect(() => {
    let active = true;

    Promise.allSettled([
      getRemoteAiSettings(),
      getRemoteSearchSettings(),
      getRemoteModels(),
    ])
      .then(([aiResult, searchResult, modelsResult]) => {
        if (!active) return;

        const officialModels =
          modelsResult.status === "fulfilled" ? modelsResult.value : [];
        const officialIds = new Set(officialModels.map((model) => model.id));
        setModels(officialModels);
        setIsLoadingModels(false);
        setModelLoadError(
          modelsResult.status === "rejected" &&
            aiResult.status === "fulfilled" &&
            aiResult.value.apiKeyConfigured
            ? getErrorMessage(modelsResult.reason)
            : "",
        );

        if (aiResult.status === "fulfilled") {
          setDraft((current) => ({
            ...current,
            modelName: officialIds.has(aiResult.value.modelName)
              ? aiResult.value.modelName
              : officialModels[0]?.id ?? aiResult.value.modelName,
            baseUrl: aiResult.value.baseUrl,
          }));
          setApiKeyConfigured(aiResult.value.apiKeyConfigured);
          setApiKeyPersisted(aiResult.value.apiKeyPersisted);
        }

        if (searchResult.status === "fulfilled") {
          setSearchKeyConfigured(searchResult.value.apiKeyConfigured);
          setSearchKeyPersisted(searchResult.value.apiKeyPersisted);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleRefreshModels() {
    if (isLoadingModels) return;
    if (!apiKeyConfigured && !draft.apiKey.trim()) {
      notify({
        variant: "warning",
        title: "请先输入 DeepSeek API Key",
        description: "官方模型列表需要使用 API Key 请求 DeepSeek /models 接口。",
      });
      return;
    }

    setIsLoadingModels(true);
    setModelLoadError("");
    try {
      const savedSettings = await updateRemoteAiSettings({ ...draft, modelName: "" });
      const officialModels = await getRemoteModels();
      setModels(officialModels);
      setDraft((current) => ({
        ...current,
        modelName: officialModels.some((model) => model.id === current.modelName)
          ? current.modelName
          : officialModels[0]?.id ?? "",
      }));
      setApiKeyConfigured(savedSettings.apiKeyConfigured);
      setApiKeyPersisted(savedSettings.apiKeyPersisted);
      notify({
        variant: "success",
        title: "官方模型列表已更新",
        description: `DeepSeek 返回 ${officialModels.length} 个可用模型。`,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setModelLoadError(message);
      notify({
        variant: "error",
        title: "获取官方模型失败",
        description: message,
      });
    } finally {
      setIsLoadingModels(false);
    }
  }

  async function handleSave() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onSave(draft);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestConnection() {
    if (isTesting) return;
    setIsTesting(true);
    try {
      const result = await testRemoteAiConnection(draft);
      setApiKeyConfigured(result.apiKeyConfigured);
      setApiKeyPersisted(result.apiKeyPersisted);
      notify(
        result.mocked
          ? {
              variant: "info",
              title: "后端连接正常",
              description: result.content,
            }
          : {
              variant: "success",
              title: result.content || "AI 服务连接正常",
              description: "后端已成功调用 DeepSeek。",
            },
      );
    } catch (error) {
      notify({
        variant: "error",
        title: "连接测试失败",
        description: getErrorMessage(error),
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleTestSearch() {
    if (isTestingSearch) return;
    setIsTestingSearch(true);
    try {
      const result = await testRemoteSearchConnection(draft.webSearchApiKey);
      setSearchKeyConfigured(result.apiKeyConfigured);
      setSearchKeyPersisted(result.apiKeyPersisted);
      notify(
        result.webSearchUsed
          ? {
              variant: "success",
              title: "Web Search 连接正常",
              description: "Tavily 已返回有效检索结果。",
            }
          : {
              variant: "warning",
              title: "Web Search 尚未启用",
              description: result.warning ?? "请检查 Tavily API Key。",
            },
      );
    } catch (error) {
      notify({
        variant: "error",
        title: "Web Search 测试失败",
        description: getErrorMessage(error),
      });
    } finally {
      setIsTestingSearch(false);
    }
  }

  return (
    <main className="page narrow">
      <section className="settings-hero settings-hero--refined">
        <button className="icon-button" onClick={onCancel} aria-label="返回">←</button>
        <div className="settings-hero-copy">
          <p>设置</p>
          <h1>服务与学习设置</h1>
          <span>连接内容服务和资料搜索，并调整课堂呈现方式。</span>
        </div>
        <div className="settings-hero-actions">
          <div className="settings-service-status">
            <span className={apiKeyConfigured ? "is-ready" : ""}>
              <i />
              DeepSeek {apiKeyConfigured ? "已配置" : "待配置"}
            </span>
            <span className={searchKeyConfigured ? "is-ready" : ""}>
              <i />
              资料搜索 {searchKeyConfigured ? "已开启" : "待配置"}
            </span>
          </div>
          <button
            className="primary-pill"
            disabled={isSaving || !draft.modelName}
            onClick={handleSave}
          >
            {isSaving ? "正在保存…" : "保存全部设置"}
          </button>
        </div>
      </section>

      <section className="settings-grid settings-grid--refined">
        <section className="panel-card settings-card settings-card--provider">
          <div className="settings-card-head">
            <div>
              <span>内容生成</span>
              <h2>DeepSeek</h2>
              <p>用于课程规划、课堂讲解、练习和学习问答。</p>
            </div>
            <span className={`settings-status-badge ${apiKeyConfigured ? "is-ready" : ""}`}>
              {apiKeyConfigured ? "可使用" : "未连接"}
            </span>
          </div>

          <div className="settings-fields settings-fields--provider">
          <label className="settings-field--wide">
            API Key
            <input
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              placeholder={apiKeyConfigured ? "后端已配置；留空表示保持不变" : "输入 DeepSeek API Key"}
            />
            <small className="settings-hint">
              {apiKeyConfigured
                ? apiKeyPersisted
                  ? "密钥已加密持久化，重启后仍可使用。"
                  : "密钥由后端环境变量提供，未写入配置文件。"
                : "密钥不会写入浏览器或以明文保存。"}
            </small>
          </label>
          <label>
            服务地址
            <input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
          </label>
          <div className="settings-select-field">
            <span className="settings-field-label">生成模型</span>
            <DropdownSelect
              ariaLabel="生成模型"
              value={draft.modelName}
              disabled={isLoadingModels || models.length === 0}
              placeholder={
                isLoadingModels
                  ? "正在获取模型…"
                  : draft.modelName || "请先获取官方模型"
              }
              options={models.map((model) => ({
                value: model.id,
                label: model.id,
                meta: model.ownedBy === "deepseek" ? "DeepSeek" : model.ownedBy,
              }))}
              onChange={(modelName) => setDraft({ ...draft, modelName })}
            />
            <small className={modelLoadError ? "settings-hint settings-hint--error" : "settings-hint"}>
              {modelLoadError
                ? modelLoadError
                : models.length
                  ? `来自 DeepSeek 官方接口 · ${models.length} 个可用模型`
                  : "模型列表不会写死，由 DeepSeek 官方接口返回。"}
            </small>
          </div>
          </div>
          <div className="settings-actions">
            <button
              className="soft-pill"
              disabled={isLoadingModels}
              onClick={handleRefreshModels}
            >
              {isLoadingModels ? "正在获取…" : "更新模型列表"}
            </button>
            <button
              className="soft-pill"
              disabled={isTesting || !draft.modelName}
              onClick={handleTestConnection}
            >
              {isTesting ? "正在检查…" : "检查连接"}
            </button>
          </div>
        </section>

        <section className="panel-card settings-card settings-card--search">
          <div className="settings-card-head">
            <div>
              <span>资料搜索</span>
              <h2>Tavily</h2>
              <p>在生成大纲和更新课堂内容时查找相关资料。</p>
            </div>
            <span className={`settings-status-badge ${searchKeyConfigured ? "is-ready" : ""}`}>
              {searchKeyConfigured ? "已开启" : "未连接"}
            </span>
          </div>

          <label>
            搜索服务密钥
            <input
              type="password"
              autoComplete="off"
              value={draft.webSearchApiKey}
              onChange={(event) =>
                setDraft({ ...draft, webSearchApiKey: event.target.value })
              }
              placeholder={
                searchKeyConfigured
                  ? "后端已配置；留空表示保持不变"
                  : "输入 Tavily API Key"
              }
            />
            <small className="settings-hint">
              {searchKeyConfigured
                ? searchKeyPersisted
                  ? "联网检索已配置，密钥已加密持久化。"
                  : "联网检索密钥由后端环境变量提供。"
                : "用于大纲生成前的联网资料检索；保存时会加密持久化。"}
            </small>
          </label>

          <div className="settings-search-note">
            <span>生成大纲时</span>
            <strong>先判断范围，再按目的搜索多组资料</strong>
            <p>搜索失败时仍会保留可编辑内容，并明确提示资料状态。</p>
          </div>

          <div className="settings-actions">
            <button
              className="soft-pill"
              disabled={isTestingSearch}
              onClick={handleTestSearch}
            >
              {isTestingSearch ? "正在检查…" : "检查资料搜索"}
            </button>
          </div>
        </section>

        <section className="panel-card settings-card settings-card--learning">
          <div className="settings-card-head">
            <div>
              <span>课堂体验</span>
              <h2>学习偏好</h2>
              <p>统一控制讲解、练习和问答的默认呈现方式。</p>
            </div>
          </div>

          <div className="settings-learning-layout">
            <div className="settings-preference-fields">
              <SelectRow label="讲解深度" value={draft.explanationDepth} options={["简单", "标准", "深入"]} onChange={(value) => setDraft({ ...draft, explanationDepth: value as ModelSettings["explanationDepth"] })} />
              <SelectRow label="题目难度" value={draft.questionDifficulty} options={["基础", "提高", "综合"]} onChange={(value) => setDraft({ ...draft, questionDifficulty: value as ModelSettings["questionDifficulty"] })} />
              <SelectRow label="回答长度" value={draft.answerLength} options={["简短", "适中", "详细"]} onChange={(value) => setDraft({ ...draft, answerLength: value as ModelSettings["answerLength"] })} />
            </div>

            <div className="settings-capabilities">
              <div>
                <span>当前使用范围</span>
                <p>这些能力会根据学习阶段自动参与，不需要逐项开关。</p>
              </div>
              <ul>
                {[
                  "项目大纲",
                  "新增内容润色",
                  "课堂讲解",
                  "知识关系",
                  "示例与练习",
                  "资料更新",
                  "学习问答",
                ].map((item) => (
                  <li key={item}>
                    <i>✓</i>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function CourseTree({
  project,
  onOpenSection,
}: {
  project: LearningProject;
  onOpenSection: (project: LearningProject, chapterId: string, sectionId: string) => void;
}) {
  return (
    <div className="course-tree">
      {project.chapters.map((chapter) => (
        <div key={chapter.id}>
          <h3>{chapter.title}</h3>
          {chapter.sections.map((section) => (
            <button
              type="button"
              aria-current={section.status === "current" ? "page" : undefined}
              key={section.id}
              className={`tree-section tree-section--${section.status}`}
              onClick={() => onOpenSection(project, chapter.id, section.id)}
            >
              <i />
              <span>{section.title}</span>
              <small>{section.status === "done" ? "已完成" : section.status === "current" ? "学习中" : "未开始"}</small>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function ProgressRing({ value, tone, large = false }: { value: number; tone: number; large?: boolean }) {
  const offset = 251.2 - (251.2 * value) / 100;
  return (
    <div className={`progress-ring progress-ring--${tone} ${large ? "progress-ring--large" : ""}`}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" />
        <circle cx="50" cy="50" r="40" strokeDasharray="251.2" strokeDashoffset={offset} />
      </svg>
      <strong>{value}%</strong>
    </div>
  );
}

function FloatingNav({ activeView, onNavigate }: { activeView: MainView; onNavigate: (view: MainView) => void }) {
  return (
    <nav className="floating-nav">
      {navItems.map((item) => (
        <button className={activeView === item.view ? "active" : ""} key={item.view} onClick={() => onNavigate(item.view)}>
          <span>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel-card">
      <div className="panel-title">
        <p>学习内容</p>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function getUnderstandingScenes(content: LessonContent): LessonScene[] {
  if (content.scenes?.length) return content.scenes;

  const scenePrefix = content.generatedAt || "legacy";
  const conceptScenes: LessonScene[] = content.explanation.paragraphs
    .slice(0, 3)
    .map((paragraph, index) => ({
      id: `${scenePrefix}-concept-${index}`,
      type: "concept",
      title: content.explanation.keyPoints[index] ?? `理解第 ${index + 1} 步`,
      instruction:
        index === 0
          ? content.explanation.lead
          : "先把这一层关系说清楚，再进入下一步。",
      body: paragraph,
      takeaway:
        content.explanation.keyPoints[index] ??
        "能够用自己的话复述这一层关系。",
    }));

  return [
    ...conceptScenes,
    {
      id: `${scenePrefix}-example`,
      type: "step-reveal",
      title: content.example.title,
      instruction: content.example.scenario,
      body: "先判断每一步的目的，再展开下一步。",
      steps: content.example.steps,
      takeaway: content.example.result,
    },
  ];
}

const lessonSceneLabels: Record<LessonScene["type"], string> = {
  prediction: "先判断",
  concept: "看关系",
  "step-reveal": "逐步展开",
  "error-diagnosis": "找出问题",
};

function getSceneConceptKey(scene: LessonScene) {
  return (
    scene.conceptKey?.trim() ||
    `concept:${(scene.navTitle ?? scene.title).trim().slice(0, 100)}`
  );
}

function getNextReviewAt(mastery: number, now = new Date()) {
  const reviewDays = mastery >= 0.8 ? 7 : mastery >= 0.6 ? 3 : 1;
  const nextReview = new Date(now);
  nextReview.setDate(nextReview.getDate() + reviewDays);
  return nextReview.toISOString();
}

function updateLessonKnowledge(
  current: Record<string, LessonKnowledgeState>,
  scene: LessonScene,
  result: {
    correct: boolean;
    attempts: number;
    hintsUsed: number;
  },
) {
  const conceptKey = getSceneConceptKey(scene);
  const previous = current[conceptKey];
  const score =
    result.correct && result.attempts === 1 && result.hintsUsed === 0
      ? 0.88
      : result.correct
        ? 0.68
        : result.attempts >= 2
          ? 0.32
          : 0.45;
  const mastery = Math.round(
    (previous ? previous.mastery * 0.55 + score * 0.45 : score) * 100,
  ) / 100;
  const lastOutcome =
    result.correct && result.attempts === 1 && result.hintsUsed === 0
      ? "mastered"
      : result.correct
        ? "supported"
        : "needs-review";
  const now = new Date();
  return {
    ...current,
    [conceptKey]: {
      conceptKey,
      label: scene.navTitle ?? scene.title,
      mastery,
      evidenceCount: (previous?.evidenceCount ?? 0) + 1,
      correctCount: (previous?.correctCount ?? 0) + (result.correct ? 1 : 0),
      attempts: (previous?.attempts ?? 0) + 1,
      hintsUsed: (previous?.hintsUsed ?? 0) + result.hintsUsed,
      lastOutcome,
      ...(!result.correct
        ? {
            misconception:
              scene.misconception ??
              scene.feedback?.incorrect ??
              "当前判断条件还没有稳定掌握。",
          }
        : previous?.misconception
          ? { misconception: previous.misconception }
          : {}),
      lastSeenAt: now.toISOString(),
      nextReviewAt: getNextReviewAt(mastery, now),
    } satisfies LessonKnowledgeState,
  };
}

function LessonSceneFlow({
  scenes,
  sectionId,
  initialProgress,
  onAskTutor,
  onComplete,
  onProgressChange,
  progressSaveState,
}: {
  scenes: LessonScene[];
  sectionId: string;
  initialProgress?: LessonProgress;
  onAskTutor: (message: string, sceneContext: TutorSceneContext) => void;
  onComplete: () => void;
  onProgressChange: (progress: LessonProgress) => void;
  progressSaveState: "idle" | "saving" | "saved" | "error";
}) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [revealedStepCount, setRevealedStepCount] = useState(0);
  const [hintCount, setHintCount] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [branchAcknowledged, setBranchAcknowledged] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeAnswer, setChallengeAnswer] = useState("");
  const [evidence, setEvidence] = useState<
    Record<string, LessonSceneEvidence>
  >({});
  const [knowledge, setKnowledge] = useState<
    Record<string, LessonKnowledgeState>
  >({});
  const [completedSceneIds, setCompletedSceneIds] = useState<string[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const sceneSignature = scenes.map((scene) => scene.id).join("|");

  useEffect(() => {
    const restoredEvidence = initialProgress?.evidence ?? {};
    const restoredCompleted = Array.from(
      new Set(initialProgress?.completedSceneIds ?? []),
    );
    const completed = new Set(restoredCompleted);
    const requestedIndex = initialProgress?.currentSceneId
      ? scenes.findIndex(
          (scene) => scene.id === initialProgress.currentSceneId,
        )
      : -1;
    const firstIncompleteIndex = scenes.findIndex(
      (scene) => !completed.has(scene.id),
    );
    const nextIndex =
      requestedIndex >= 0
        ? requestedIndex
        : firstIncompleteIndex >= 0
          ? firstIncompleteIndex
          : 0;
    const restoredScene = scenes[nextIndex];
    const restoredSceneEvidence = restoredScene
      ? restoredEvidence[restoredScene.id]
      : undefined;

    setSceneIndex(nextIndex);
    setSelectedIndex(restoredSceneEvidence?.selectedIndex ?? null);
    setSubmitted(restoredSceneEvidence?.correct !== undefined);
    setRevealedStepCount(
      restoredSceneEvidence?.completed && restoredScene?.type === "step-reveal"
        ? restoredScene.steps?.length ?? 0
        : 0,
    );
    setHintCount(restoredSceneEvidence?.hintsUsed ?? 0);
    setAttempts(restoredSceneEvidence?.attempts ?? 0);
    setBranchAcknowledged(restoredSceneEvidence?.completed ?? false);
    setChallengeOpen(restoredSceneEvidence?.route === "challenge");
    setChallengeAnswer("");
    setEvidence(restoredEvidence);
    setKnowledge(initialProgress?.knowledge ?? {});
    setCompletedSceneIds(restoredCompleted);
    setIsFinished(
      scenes.length > 0 && scenes.every((scene) => completed.has(scene.id)),
    );
  }, [sectionId, sceneSignature]);

  if (!scenes.length) return null;

  const scene = scenes[Math.min(sceneIndex, scenes.length - 1)];
  const isChoiceScene =
    scene.type === "prediction" || scene.type === "error-diagnosis";
  const steps = scene.steps ?? [];
  const isCorrect =
    submitted &&
    selectedIndex !== null &&
    selectedIndex === scene.answerIndex;
  const shouldRevealAnswer = submitted && (isCorrect || attempts >= 2);
  const availableHints =
    scene.hints?.length
      ? scene.hints
      : [
          "先圈出题目中真正决定答案的条件，再排除明显不符合的选项。",
          "把场景里的条件逐一对应到每个选项，不要只看熟悉的词。",
        ];
  const nextScene = scenes[sceneIndex + 1];
  const canFastTrackNext =
    nextScene?.type === "concept" &&
    (!scene.conceptKey ||
      !nextScene.conceptKey ||
      scene.conceptKey === nextScene.conceptKey);
  const canAdvance =
    scene.type === "concept" ||
    (scene.type === "step-reveal" &&
      revealedStepCount >= steps.length) ||
    (isChoiceScene &&
      submitted &&
      (isCorrect || (attempts >= 2 && branchAcknowledged)));

  function createProgress(
    currentSceneId: string | undefined,
    nextEvidence: Record<string, LessonSceneEvidence>,
    nextCompletedSceneIds: string[],
    nextKnowledge = knowledge,
  ): LessonProgress {
    return {
      schemaVersion: 1,
      ...(currentSceneId ? { currentSceneId } : {}),
      completedSceneIds: Array.from(new Set(nextCompletedSceneIds)),
      evidence: nextEvidence,
      knowledge: nextKnowledge,
      updatedAt: new Date().toISOString(),
    };
  }

  function loadSceneInteraction(
    nextIndex: number,
    nextEvidence: Record<string, LessonSceneEvidence>,
  ) {
    const nextScene = scenes[nextIndex];
    const saved = nextScene ? nextEvidence[nextScene.id] : undefined;
    setSceneIndex(nextIndex);
    setSelectedIndex(saved?.selectedIndex ?? null);
    setSubmitted(saved?.correct !== undefined);
    setRevealedStepCount(
      saved?.completed && nextScene?.type === "step-reveal"
        ? nextScene.steps?.length ?? 0
        : 0,
    );
    setHintCount(saved?.hintsUsed ?? 0);
    setAttempts(saved?.attempts ?? 0);
    setBranchAcknowledged(saved?.completed ?? false);
    setChallengeOpen(saved?.route === "challenge");
    setChallengeAnswer("");
  }

  function updateCurrentEvidence(
    patch: Partial<LessonSceneEvidence>,
    persist = true,
    nextKnowledge = knowledge,
  ) {
    const previous = evidence[scene.id];
    const nextItem: LessonSceneEvidence = {
      ...previous,
      ...patch,
      sceneId: scene.id,
      attempts: patch.attempts ?? previous?.attempts ?? attempts,
      hintsUsed: patch.hintsUsed ?? previous?.hintsUsed ?? hintCount,
      completed: patch.completed ?? previous?.completed ?? false,
      updatedAt: new Date().toISOString(),
    };
    const nextEvidence = { ...evidence, [scene.id]: nextItem };
    setEvidence(nextEvidence);
    if (persist) {
      onProgressChange(
        createProgress(
          scene.id,
          nextEvidence,
          completedSceneIds,
          nextKnowledge,
        ),
      );
    }
    return nextEvidence;
  }

  function showNextHint() {
    if (hintCount >= availableHints.length || submitted) return;
    const nextHintCount = hintCount + 1;
    setHintCount(nextHintCount);
    updateCurrentEvidence({ hintsUsed: nextHintCount });
  }

  function submitChoice() {
    if (selectedIndex === null) return;
    const nextAttempts = attempts + 1;
    const correct = selectedIndex === scene.answerIndex;
    const nextHintCount =
      !correct && nextAttempts === 1 && hintCount === 0
        ? Math.min(1, availableHints.length)
        : hintCount;
    const nextKnowledge = updateLessonKnowledge(knowledge, scene, {
      correct,
      attempts: nextAttempts,
      hintsUsed: attempts === 0 ? nextHintCount : 0,
    });
    setAttempts(nextAttempts);
    setHintCount(nextHintCount);
    setSubmitted(true);
    setBranchAcknowledged(correct);
    setChallengeOpen(false);
    setKnowledge(nextKnowledge);
    updateCurrentEvidence({
      selectedIndex,
      correct,
      attempts: nextAttempts,
      hintsUsed: nextHintCount,
      completed: false,
      firstTryCorrect: nextAttempts === 1 ? correct : false,
      outcome:
        correct && nextAttempts === 1 && nextHintCount === 0
          ? "mastered"
          : correct
            ? "supported"
            : "needs-review",
      route: correct ? "standard" : "support",
    }, true, nextKnowledge);
  }

  function retryChoice() {
    setSelectedIndex(null);
    setSubmitted(false);
    setBranchAcknowledged(false);
    setChallengeOpen(false);
  }

  function advanceScene(
    route: "standard" | "support" | "fast-track" | "challenge" = "standard",
  ) {
    if (!canAdvance) return;
    let nextCompletedSceneIds = Array.from(
      new Set([...completedSceneIds, scene.id]),
    );
    let nextEvidence = updateCurrentEvidence(
      {
        selectedIndex: selectedIndex ?? undefined,
        correct: isChoiceScene ? isCorrect : undefined,
        attempts,
        hintsUsed: hintCount,
        completed: true,
        route,
      },
      false,
      knowledge,
    );
    setCompletedSceneIds(nextCompletedSceneIds);

    let nextIndex = sceneIndex + 1;
    if (
      route === "fast-track" &&
      nextIndex < scenes.length &&
      canFastTrackNext
    ) {
      const skippedScene = scenes[nextIndex];
      nextCompletedSceneIds = Array.from(
        new Set([...nextCompletedSceneIds, skippedScene.id]),
      );
      nextEvidence = {
        ...nextEvidence,
        [skippedScene.id]: {
          sceneId: skippedScene.id,
          attempts: 0,
          hintsUsed: 0,
          completed: true,
          outcome: "skipped",
          route: "fast-track",
          updatedAt: new Date().toISOString(),
        },
      };
      setEvidence(nextEvidence);
      setCompletedSceneIds(nextCompletedSceneIds);
      nextIndex += 1;
    }

    if (nextIndex >= scenes.length) {
      setIsFinished(true);
      onProgressChange(
        createProgress(
          undefined,
          nextEvidence,
          nextCompletedSceneIds,
          knowledge,
        ),
      );
      onComplete();
      return;
    }
    loadSceneInteraction(nextIndex, nextEvidence);
    onProgressChange(
      createProgress(
        scenes[nextIndex].id,
        nextEvidence,
        nextCompletedSceneIds,
        knowledge,
      ),
    );
  }

  if (isFinished) {
    const interactionCount = scenes.filter(
      (item) =>
        item.type === "prediction" ||
        item.type === "error-diagnosis" ||
        item.type === "step-reveal",
    ).length;
    const knowledgeItems = Object.values(knowledge);
    const reviewItem = knowledgeItems
      .slice()
      .sort(
        (left, right) =>
          new Date(left.nextReviewAt).getTime() -
          new Date(right.nextReviewAt).getTime(),
      )[0];
    return (
      <section className="lesson-scene-complete" aria-live="polite">
        <span>✓</span>
        <div>
          <small>理解路径已完成</small>
          <h3>刚才不是“读完了”，而是做完了 {interactionCount} 次判断与展开</h3>
          <p>
            共尝试 {Object.values(evidence).reduce((sum, item) => sum + item.attempts, 0)}{" "}
            次，使用 {Object.values(evidence).reduce((sum, item) => sum + item.hintsUsed, 0)}{" "}
            条提示。下面换一个问题，看看这些关系能不能真正用出来。
          </p>
          {knowledgeItems.length ? (
            <div className="lesson-mastery-summary">
              <span>
                已形成 <strong>{knowledgeItems.length}</strong> 条掌握记录
              </span>
              {reviewItem ? (
                <span>
                  建议在{" "}
                  <strong>
                    {new Date(reviewItem.nextReviewAt).toLocaleDateString(
                      "zh-CN",
                      { month: "short", day: "numeric" },
                    )}
                  </strong>{" "}
                  回看“{reviewItem.label}”
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <button
          className="soft-pill"
          onClick={() => {
            setIsFinished(false);
            loadSceneInteraction(0, evidence);
          }}
        >
          回看第一幕
        </button>
      </section>
    );
  }

  return (
    <section className="lesson-scene-workbench">
      <aside className="lesson-scene-rail" aria-label="理解路径">
        <div>
          <small>
            {completedSceneIds.includes(scene.id)
              ? "正在回看"
              : progressSaveState === "saving"
              ? "正在记录"
              : progressSaveState === "error"
                ? "记录失败"
                : progressSaveState === "saved"
                  ? "已记录"
                  : "理解路径"}
          </small>
          <strong>第 {sceneIndex + 1} 幕</strong>
          <em>已完成 {completedSceneIds.length}/{scenes.length}</em>
        </div>
        <ol>
          {scenes.map((item, index) => (
            <li
              className={[
                completedSceneIds.includes(item.id) ? "is-complete" : "",
                index === sceneIndex ? "is-current" : "",
              ].join(" ")}
              key={item.id}
            >
              <i>
                {completedSceneIds.includes(item.id)
                  ? "✓"
                  : String(index + 1).padStart(2, "0")}
              </i>
              <span>
                <strong>{item.navTitle ?? item.title}</strong>
                <small>{lessonSceneLabels[item.type]}</small>
              </span>
            </li>
          ))}
        </ol>
      </aside>

      <article className={`lesson-scene lesson-scene--${scene.type}`}>
        <header>
          <span>{lessonSceneLabels[scene.type]}</span>
          <small>第 {sceneIndex + 1} 幕</small>
          <h3>{scene.title}</h3>
          <p>{scene.instruction}</p>
        </header>

        {scene.body ? <div className="lesson-scene-body">{scene.body}</div> : null}

        {isChoiceScene && scene.options?.length ? (
          <div className="lesson-scene-choice">
            <div className="lesson-scene-options">
              {scene.options.map((option, optionIndex) => {
                const isSelected = selectedIndex === optionIndex;
                const isAnswer =
                  shouldRevealAnswer && optionIndex === scene.answerIndex;
                const isWrong =
                  submitted &&
                  isSelected &&
                  optionIndex !== scene.answerIndex;
                return (
                  <button
                    className={[
                      isSelected ? "is-selected" : "",
                      isAnswer ? "is-correct" : "",
                      isWrong ? "is-wrong" : "",
                    ].join(" ")}
                    disabled={submitted}
                    key={`${option}-${optionIndex}`}
                    onClick={() => setSelectedIndex(optionIndex)}
                  >
                    <i>{String.fromCharCode(65 + optionIndex)}</i>
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>
            {!submitted ? (
              <div className="lesson-scene-hints">
                {hintCount > 0 ? (
                  <ol aria-label="已显示的提示">
                    {availableHints.slice(0, hintCount).map((hint, index) => (
                      <li key={`${hint}-${index}`}>
                        <span>{index + 1}</span>
                        <p>{hint}</p>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {hintCount < availableHints.length ? (
                  <button className="soft-pill" onClick={showNextHint}>
                    {hintCount === 0 ? "给我一点提示" : "再给一点提示"}
                  </button>
                ) : (
                  <small>提示已全部展开，现在试着自己判断。</small>
                )}
              </div>
            ) : null}
            {!submitted ? (
              <button
                className="primary-pill"
                disabled={selectedIndex === null}
                onClick={submitChoice}
              >
                确认判断
              </button>
            ) : (
              <div
                className={`lesson-scene-feedback ${isCorrect ? "is-correct" : "is-wrong"}`}
                role="status"
              >
                <strong>{isCorrect ? "这个判断成立" : "这里容易混淆"}</strong>
                <p>
                  {isCorrect
                    ? scene.feedback?.correct
                    : attempts < 2
                      ? `先不公布答案。${availableHints[Math.max(0, hintCount - 1)] ?? "重新对照题目中的判断条件，再试一次。"}`
                      : scene.feedback?.incorrect}
                </p>
                {!isCorrect ? (
                  <>
                    <button
                      onClick={() =>
                        onAskTutor(
                          `我在“${scene.title}”这一步判断错了，请只解释我忽略的条件，不要直接扩展到后面的内容。`,
                          {
                            sceneId: scene.id,
                            selectedIndex: selectedIndex ?? undefined,
                            correct: false,
                          },
                        )
                      }
                    >
                      问问我忽略了什么
                    </button>
                    {attempts < 2 ? (
                      <section className="lesson-scene-branch is-retry">
                        <small>再判断一次</small>
                        <strong>正确答案还没有显示</strong>
                        <p>
                          这次只根据上面的提示，重新比较各个选项。
                        </p>
                        <button className="soft-pill" onClick={retryChoice}>
                          换个选择再试一次
                        </button>
                      </section>
                    ) : (
                      <section className="lesson-scene-branch is-remediation">
                        <small>换个角度</small>
                        <strong>先补上这个缺口</strong>
                        <p>
                          {scene.remediation ??
                            scene.feedback?.incorrect ??
                            "回到题干，把决定答案的条件与刚才选择的理由逐一对照。"}
                        </p>
                        {!branchAcknowledged ? (
                          <button
                            className="soft-pill"
                            onClick={() => setBranchAcknowledged(true)}
                          >
                            我明白错在哪里了
                          </button>
                        ) : (
                          <span>可以继续了</span>
                        )}
                      </section>
                    )}
                  </>
                ) : challengeOpen && scene.challenge ? (
                  <section className="lesson-scene-branch is-challenge">
                    <small>想深一层</small>
                    <strong>先用自己的话判断</strong>
                    <p>{scene.challenge}</p>
                    <textarea
                      aria-label="写下你的挑战思路"
                      placeholder="不用写得很长，说清楚判断依据即可…"
                      value={challengeAnswer}
                      onChange={(event) =>
                        setChallengeAnswer(event.target.value.slice(0, 500))
                      }
                    />
                    <button
                      className="soft-pill"
                      disabled={!challengeAnswer.trim()}
                      onClick={() =>
                        onAskTutor(
                          `针对这一幕的进阶问题“${scene.challenge}”，我的判断是：${challengeAnswer.trim()}。请检查我的判断依据，只指出最需要修正的一点。`,
                          {
                            sceneId: scene.id,
                            selectedIndex: selectedIndex ?? undefined,
                            correct: true,
                          },
                        )
                      }
                    >
                      检查我的判断
                    </button>
                  </section>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {scene.type === "step-reveal" ? (
          <div className="lesson-scene-reveal">
            {revealedStepCount === 0 ? (
              <p>答案还没有展开。先在心里想一下第一步应该做什么。</p>
            ) : null}
            <ol>
              {steps.slice(0, revealedStepCount).map((step, index) => (
                <li key={`${step}-${index}`}>
                  <span>{index + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
            {revealedStepCount < steps.length ? (
              <button
                className="soft-pill"
                onClick={() =>
                  setRevealedStepCount((current) =>
                    Math.min(steps.length, current + 1),
                  )
                }
              >
                {revealedStepCount === 0 ? "展开第一步" : "展开下一步"}
              </button>
            ) : null}
          </div>
        ) : null}

        {canAdvance ? (
          <footer>
            <div>
              <small>这一幕带走什么</small>
              <strong>{scene.takeaway}</strong>
            </div>
            {isChoiceScene && isCorrect ? (
              <div className="lesson-route-actions">
                {attempts === 1 &&
                hintCount === 0 &&
                canFastTrackNext ? (
                  <button
                    className="scene-next-button"
                    onClick={() =>
                      advanceScene(challengeOpen ? "challenge" : "fast-track")
                    }
                  >
                    {challengeOpen ? "带着挑战继续" : "直接继续"}
                    <span>→</span>
                  </button>
                ) : (
                  <button
                    className="scene-next-button"
                    onClick={() =>
                      advanceScene(challengeOpen ? "challenge" : "standard")
                    }
                  >
                    {sceneIndex === scenes.length - 1
                      ? "完成理解"
                      : "继续下一幕"}
                    <span>→</span>
                  </button>
                )}
                {attempts === 1 &&
                hintCount === 0 &&
                canFastTrackNext ? (
                  <button
                    className="soft-pill"
                    onClick={() => advanceScene("standard")}
                  >
                    仍然看一下原理
                  </button>
                ) : (
                  <button
                    className="soft-pill"
                    onClick={() =>
                      onAskTutor(
                        `请围绕“${scene.title}”换一个不同的具体例子，先给场景，不要立刻公布判断。`,
                        {
                          sceneId: scene.id,
                          selectedIndex: selectedIndex ?? undefined,
                          correct: true,
                        },
                      )
                    }
                  >
                    换个例子
                  </button>
                )}
                {scene.challenge ? (
                  <button
                    className={[
                      "soft-pill",
                      challengeOpen ? "is-active" : "",
                    ].join(" ")}
                    onClick={() => setChallengeOpen((current) => !current)}
                  >
                    {challengeOpen ? "收起挑战" : "挑战一下"}
                  </button>
                ) : null}
              </div>
            ) : isChoiceScene && !isCorrect ? (
              <div className="lesson-route-actions">
                <button
                  className="scene-next-button"
                  onClick={() => advanceScene("support")}
                >
                  带着修正继续
                  <span>→</span>
                </button>
                <button
                  className="soft-pill"
                  onClick={() =>
                    onAskTutor(
                      `请围绕“${scene.title}”换一个更小、更直观的例子，帮助我检查刚才的误区。`,
                      {
                        sceneId: scene.id,
                        selectedIndex: selectedIndex ?? undefined,
                        correct: false,
                      },
                    )
                  }
                >
                  再看一个例子
                </button>
              </div>
            ) : (
              <button
                className="scene-next-button"
                onClick={() => advanceScene("standard")}
              >
                {sceneIndex === scenes.length - 1 ? "完成理解" : "进入下一幕"}
                <span>→</span>
              </button>
            )}
          </footer>
        ) : null}
      </article>
    </section>
  );
}

function PracticeCard({
  exercise,
  sectionId,
  onAskForHint,
  onResult,
  onRetry,
}: {
  exercise: LessonContent["exercise"];
  sectionId: string;
  onAskForHint: (level: number) => Promise<string | undefined>;
  onResult: (result: {
    correct: boolean;
    selectedIndex: number;
    resolved: boolean;
  }) => void;
  onRetry: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [hintCount, setHintCount] = useState(0);
  const [hintText, setHintText] = useState("");
  const [isHintLoading, setIsHintLoading] = useState(false);

  useEffect(() => {
    setSelected(null);
    setSubmitted(false);
    setAttempts(0);
    setHintCount(0);
    setHintText("");
    setIsHintLoading(false);
  }, [sectionId, exercise.question]);

  const isCorrect =
    submitted &&
    selected !== null &&
    selected === exercise.answerIndex;
  const isResolved = isCorrect || attempts >= 2;
  const shouldRevealAnswer = submitted && isResolved;

  async function requestHint() {
    if (isHintLoading || hintCount >= 2) return;
    const nextLevel = hintCount + 1;
    setIsHintLoading(true);
    const answer = await onAskForHint(nextLevel);
    if (answer) {
      setHintText(answer);
      setHintCount(nextLevel);
    }
    setIsHintLoading(false);
  }

  function submitAnswer() {
    if (selected === null) return;
    const nextAttempts = attempts + 1;
    const correct = selected === exercise.answerIndex;
    const resolved = correct || nextAttempts >= 2;
    setAttempts(nextAttempts);
    setSubmitted(true);
    onResult({
      correct,
      selectedIndex: selected,
      resolved,
    });
  }

  function chooseAgain() {
    setSelected(null);
    setSubmitted(false);
    onRetry();
  }

  function resetPractice() {
    setSelected(null);
    setSubmitted(false);
    setAttempts(0);
    setHintCount(0);
    setHintText("");
    onRetry();
  }

  return (
    <section className="practice-workbench">
      <aside className="practice-brief">
        <div>
          <small>应用任务</small>
          <h3>只完成一个判断</h3>
          <p>
            不用复述刚才的内容。把学到的关系用在一个新问题上。
          </p>
        </div>
        <dl>
          <div>
            <dt>作答</dt>
            <dd>{attempts} / 2</dd>
          </div>
          <div>
            <dt>提示</dt>
            <dd>{hintCount} / 2</dd>
          </div>
        </dl>
        <div
          className={[
            "practice-state",
            isCorrect
              ? "is-correct"
              : submitted
                ? "is-retry"
                : "is-ready",
          ].join(" ")}
        >
          <span />
          <div>
            <small>当前状态</small>
            <strong>
              {isCorrect
                ? "判断成立"
                : submitted && attempts >= 2
                  ? "已完成修正"
                  : submitted
                    ? "保留答案，再想一次"
                    : selected !== null
                      ? "可以提交判断"
                      : "等待你的选择"}
            </strong>
          </div>
        </div>
      </aside>

      <article className="practice-task">
        <header>
          <div>
            <small>迁移判断</small>
            <span>单选</span>
          </div>
          <h3>{exercise.question}</h3>
        </header>

        <div className="practice-options">
          {exercise.options.map((option, optionIndex) => {
            const isSelected = selected === optionIndex;
            const isAnswer =
              shouldRevealAnswer && optionIndex === exercise.answerIndex;
            const isWrong =
              submitted &&
              isSelected &&
              optionIndex !== exercise.answerIndex;
            return (
              <button
                className={[
                  isSelected ? "is-selected" : "",
                  isAnswer ? "is-correct" : "",
                  isWrong ? "is-wrong" : "",
                ].join(" ")}
                disabled={submitted}
                key={`${option}-${optionIndex}`}
                onClick={() => setSelected(optionIndex)}
              >
                <i>{String.fromCharCode(65 + optionIndex)}</i>
                <span>{option}</span>
                <em />
              </button>
            );
          })}
        </div>

        {hintText ? (
          <section className="practice-hint" aria-live="polite">
            <span>{String(hintCount).padStart(2, "0")}</span>
            <div>
              <small>助教提示</small>
              <p>{hintText}</p>
            </div>
          </section>
        ) : null}

        {submitted ? (
          <section
            className={[
              "practice-feedback",
              isCorrect ? "is-correct" : "is-wrong",
            ].join(" ")}
            role="status"
          >
            <small>
              {isCorrect
                ? "判断正确"
                : attempts < 2
                  ? "第一次尝试"
                  : "完成订正"}
            </small>
            <strong>
              {isCorrect
                ? "你已经把刚才的关系用出来了"
                : attempts < 2
                  ? "先不显示正确答案"
                  : "现在对照完整解析"}
            </strong>
            <p>
              {isCorrect || attempts >= 2
                ? exercise.explanation
                : "重新检查题目中的限定词，以及每个选项是否同时满足这些条件。"}
            </p>
          </section>
        ) : null}

        <footer className="practice-actions">
          {!submitted ? (
            <>
              <button
                className="scene-next-button"
                disabled={selected === null}
                onClick={submitAnswer}
              >
                提交判断 <span>→</span>
              </button>
              {hintCount < 2 ? (
                <button
                  className="soft-pill"
                  disabled={isHintLoading}
                  onClick={() => void requestHint()}
                >
                  {isHintLoading
                    ? "正在准备提示…"
                    : hintCount === 0
                      ? "给我一点提示"
                      : "再给一点提示"}
                </button>
              ) : null}
            </>
          ) : !isResolved ? (
            <>
              <button className="scene-next-button" onClick={chooseAgain}>
                重新选择 <span>↻</span>
              </button>
              {hintCount < 2 ? (
                <button
                  className="soft-pill"
                  disabled={isHintLoading}
                  onClick={() => void requestHint()}
                >
                  {isHintLoading ? "正在准备提示…" : "再给一点提示"}
                </button>
              ) : null}
            </>
          ) : (
            <button className="soft-pill" onClick={resetPractice}>
              重新练习
            </button>
          )}
        </footer>
      </article>
    </section>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="settings-select-field">
      <span className="settings-field-label">{label}</span>
      <DropdownSelect
        ariaLabel={label}
        value={value}
        options={options.map((option) => ({ value: option, label: option }))}
        onChange={onChange}
      />
    </div>
  );
}

type DropdownOption = {
  value: string;
  label: string;
  meta?: string;
};

function DropdownSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "请选择",
  disabled = false,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [isOpen]);

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  function openMenu() {
    if (disabled || options.length === 0) return;
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setIsOpen(true);
  }

  function commitOption(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setHighlightedIndex(index);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled || options.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setHighlightedIndex((current) => {
        const start = current >= 0 ? current : selectedIndex >= 0 ? selectedIndex : 0;
        return (start + direction + options.length) % options.length;
      });
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!isOpen) openMenu();
      setHighlightedIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
      } else {
        commitOption(highlightedIndex >= 0 ? highlightedIndex : selectedIndex);
      }
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
    }
  }

  return (
    <div
      className={`custom-select${isOpen ? " is-open" : ""}`}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-activedescendant={
          isOpen && highlightedIndex >= 0
            ? `${listboxId}-option-${highlightedIndex}`
            : undefined
        }
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className={selectedOption ? "" : "is-placeholder"}>
          {selectedOption?.label ?? placeholder}
        </span>
        <i aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="custom-select-menu" id={listboxId} role="listbox">
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isHighlighted = index === highlightedIndex;
            return (
              <button
                type="button"
                id={`${listboxId}-option-${index}`}
                className={[
                  "custom-select-option",
                  isSelected ? "is-selected" : "",
                  isHighlighted ? "is-highlighted" : "",
                ].join(" ")}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                key={option.value}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => commitOption(index)}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.meta ? <small>{option.meta}</small> : null}
                </span>
                <i className="custom-select-check" aria-hidden="true">
                  {isSelected ? "✓" : ""}
                </i>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
