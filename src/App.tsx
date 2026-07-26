import { useEffect, useMemo, useRef, useState } from "react";
import {
  askRemoteTutor,
  completeRemoteSection,
  createRemoteProject,
  generateRemoteLesson,
  generateRemoteOutline,
  generateRemoteProjectDescription,
  getRemoteAiSettings,
  getRemoteModels,
  getRemoteSearchSettings,
  saveRemoteOutline,
  testRemoteAiConnection,
  testRemoteSearchConnection,
  updateRemoteAiSettings,
  updateRemoteSearchSettings,
  type RemoteModel,
  type TutorHistoryItem,
} from "./api";
import { useToast } from "./components/ui/toast";
import {
  CourseChapter,
  createProjectFromGoal,
  LessonContent,
  LessonSection,
  LearningProject,
  ModelSettings,
  StudyState,
} from "./studyAgent";
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

export default function App() {
  const { notify } = useToast();
  const [state, setState] = useState<StudyState>(() => loadStudyState());
  const [view, setView] = useState<AppView>("home");
  const [draftProject, setDraftProject] = useState<LearningProject | null>(null);

  useEffect(() => {
    saveStudyState(state);
  }, [state]);

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

  async function startCreate(topic: string, description: string) {
    go("generating");
    let project: LearningProject;

    try {
      project = await createRemoteProject({ topic, description });
      try {
        const generated = await generateRemoteOutline(project.id);
        project = generated.project;
        if (generated.data.warning) {
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
      project = createProjectFromGoal({ topic, description });
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
        title: "AI 润色新增节点失败",
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

  const showMainNav = ["home", "plan", "review", "stats", "detail", "settings"].includes(view);

  return (
    <div className="app">
      <GlobalTopBar onHome={() => go("home")} onSettings={() => go("settings")} />

      {view === "home" && <HomePage projects={state.projects} onCreate={() => go("create")} onOpenProject={selectProject} />}
      {view === "plan" && (activeProject ? <PlanPage project={activeProject} onOpenSection={openSection} /> : <EmptyProjectPage title="还没有学习计划" onCreate={() => go("create")} />)}
      {view === "review" && (activeProject ? <ReviewPage project={activeProject} onOpenSection={openSection} /> : <EmptyProjectPage title="还没有可复习内容" onCreate={() => go("create")} />)}
      {view === "stats" && (activeProject ? <StatsPage projects={state.projects} activeProject={activeProject} /> : <EmptyProjectPage title="还没有学习统计" onCreate={() => go("create")} />)}
      {view === "create" && <CreateProjectPage onCancel={() => go("home")} onCreate={startCreate} />}
      {view === "generating" && <GeneratingPage />}
      {view === "outline" && draftProject && (
        <OutlinePage
          project={draftProject}
          onBack={() => go("create")}
          onNext={finishOutline}
          onOptimize={optimizeDraftOutline}
          onChange={updateDraftChapters}
        />
      )}
      {view === "detail" && activeProject && <CourseDetailPage project={activeProject} onOpenSection={openSection} onBack={() => go("home")} />}
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
                title: "AI 与 Web Search 设置已保存",
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

      {showMainNav && <FloatingNav activeView={view as MainView} onNavigate={go} />}
    </div>
  );
}

function GlobalTopBar({ onHome, onSettings }: { onHome: () => void; onSettings: () => void }) {
  return (
    <header className="global-bar">
      <button className="brand-dot" onClick={onHome} aria-label="返回首页">圆</button>
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
}: {
  projects: LearningProject[];
  onCreate: () => void;
  onOpenProject: (project: LearningProject) => void;
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
          <button className="project-card" key={project.id} onClick={() => onOpenProject(project)}>
            <ProgressRing value={project.progress} tone={index % 3} />
            <div className="project-copy">
              <h2>{project.title}</h2>
              <p>{project.description}</p>
              <span>{project.lastStudied} · {project.pendingTasks} 项待完成</span>
            </div>
            <span className="round-play">▶</span>
          </button>
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
  onCreate: (topic: string, description: string) => void;
}) {
  const { notify } = useToast();
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);

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
        title: "Agent 生成描述失败",
        description: getErrorMessage(error),
      });
    } finally {
      setIsGeneratingDescription(false);
    }
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
                ? "Agent 生成中…"
                : description.trim()
                  ? "Agent 重新生成"
                  : "Agent 生成"}
            </button>
          </div>
          <textarea
            id="project-description"
            value={description}
            aria-busy={isGeneratingDescription}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={
              topic.trim()
                ? "可以手动填写，或让 Agent 根据课题名称生成…"
                : "例如：每天背诵 3 首，整理意象并记录感悟..."
            }
            rows={5}
          />
          <small className="field-help">
            Agent 只填写描述，不会直接创建项目；生成后仍可手动修改。
          </small>
        </div>
        <div className="create-orb">✓</div>
        <button className="primary-pill" disabled={!topic.trim()} onClick={() => onCreate(topic, description)}>
          创建项目 →
        </button>
        <button className="text-button" onClick={onCancel}>取消并返回主界面</button>
      </section>
    </main>
  );
}

function GeneratingPage() {
  return (
    <main className="center-page">
      <section className="generating-card">
        <div className="orbit-loader"><span /><span /><span /></div>
        <h1>正在生成学习大纲</h1>
        <p>正在联网检索相关资料、核对来源，并生成可调整的项目目录。</p>
        <div className="stage-list">
          <span>理解课题</span>
          <span>联网检索</span>
          <span>生成大纲</span>
        </div>
      </section>
    </main>
  );
}

function OutlinePage({
  project,
  onBack,
  onNext,
  onOptimize,
  onChange,
}: {
  project: LearningProject;
  onBack: () => void;
  onNext: () => Promise<void>;
  onOptimize: () => Promise<void>;
  onChange: (chapters: CourseChapter[]) => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const manualNodeCount = project.chapters.reduce(
    (count, chapter) =>
      count +
      (isUserAddedOutlineNode(chapter) ? 1 : 0) +
      chapter.sections.filter(isUserAddedOutlineNode).length,
    0,
  );

  function updateChapter(chapterId: string, title: string) {
    onChange(project.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, title } : chapter)));
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

  return (
    <main className="page narrow">
      <div className="toolbar-card">
        <button className="icon-button" onClick={onBack} aria-label="返回">←</button>
        <h1>调整学习大纲</h1>
        <button
          className="soft-pill"
          disabled={isOptimizing || manualNodeCount === 0}
          title={
            manualNodeCount
              ? "只润色手动新增节点的标题与学习描述"
              : "请先手动添加章节或小节"
          }
          onClick={handleOptimize}
        >
          {isOptimizing
            ? "正在润色新增节点…"
            : manualNodeCount
              ? `AI 润色新增节点 (${manualNodeCount})`
              : "暂无新增节点可润色"}
        </button>
      </div>

      {project.outlineSummary ? (
        <section className="outline-summary-card">
          <div>
            <span>课程目标</span>
            <strong>{project.outlineSummary.courseGoal}</strong>
          </div>
          <div>
            <span>适用人群</span>
            <strong>{project.outlineSummary.audience}</strong>
          </div>
          <div>
            <span>预计学习</span>
            <strong>{project.outlineSummary.estimatedHours} 小时</strong>
          </div>
        </section>
      ) : null}

      <section className="outline-card">
        {project.chapters.map((chapter, chapterIndex) => (
          <div className="chapter-block" key={chapter.id}>
            <div className="chapter-title">
              <span>{chapterIndex + 1}</span>
              <input value={chapter.title} onChange={(event) => updateChapter(chapter.id, event.target.value)} />
            </div>
            <div className="chapter-meta">
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
              {chapter.estimatedHours ? <span>约 {chapter.estimatedHours} 小时</span> : null}
              {chapter.objective ? <p>{chapter.objective}</p> : null}
              {chapter.prerequisites?.length ? (
                <small>前置：{chapter.prerequisites.join("、")}</small>
              ) : null}
            </div>
            <div className="section-list">
              {chapter.sections.map((section, sectionIndex) => (
                <div className="section-row" key={section.id}>
                  <i />
                  <small>{chapterIndex + 1}.{sectionIndex + 1}</small>
                  <div className="section-copy">
                    <input value={section.title} onChange={(event) => updateSection(chapter.id, section.id, event.target.value)} />
                    {section.kind || section.outcome ? (
                      <small>
                        {section.kind ? sectionKindLabels[section.kind] : "学习"}
                        {section.outcome ? ` · ${section.outcome}` : ""}
                      </small>
                    ) : null}
                  </div>
                  <button
                    disabled={chapter.sections.length <= 1}
                    onClick={() => removeSection(chapter.id, section.id)}
                    aria-label={`删除${section.title}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button className="add-line" onClick={() => addSection(chapter.id)}>＋ 添加小节</button>
            </div>
          </div>
        ))}
        <button className="add-chapter" onClick={addChapter}>＋ 添加章节</button>
      </section>

      {project.sources?.length ? (
        <section className="source-card">
          <div className="panel-title">
            <p>Web Search</p>
            <h2>本次大纲参考资料</h2>
          </div>
          <div className="source-list">
            {project.sources.map((source, index) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
                <span>{index + 1}</span>
                <div>
                  <strong>{source.title}</strong>
                  <small>{source.snippet}</small>
                </div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <div className="bottom-action">
        <button className="primary-pill" disabled={isSaving} onClick={handleNext}>
          {isSaving ? "正在保存…" : "下一步 →"}
        </button>
      </div>
    </main>
  );
}

function CourseDetailPage({
  project,
  onOpenSection,
  onBack,
}: {
  project: LearningProject;
  onOpenSection: (project: LearningProject, chapterId: string, sectionId: string) => void;
  onBack: () => void;
}) {
  const currentPosition = getFirstCoursePosition(project);

  return (
    <main className="page">
      <section className="detail-hero">
        <button className="icon-button" onClick={onBack} aria-label="返回">←</button>
        <div>
          <p>课程详情</p>
          <h1>{project.title}</h1>
          <span>{project.description}</span>
        </div>
        <ProgressRing value={project.progress} tone={0} large />
      </section>

      <section className="status-grid">
        <StatusCard label="整体进度" value={`${project.progress}%`} />
        <StatusCard label="本周学习" value={`${project.weeklyMinutes} 分钟`} />
        <StatusCard label="正确率" value={`${project.accuracy}%`} />
        <StatusCard label="薄弱点" value={`${project.weakPoints.length} 个`} />
      </section>

      <section className="detail-grid">
        <div className="panel-card">
          <div className="panel-title">
            <p>项目目录</p>
            <h2>章与节</h2>
          </div>
          <CourseTree project={project} onOpenSection={onOpenSection} />
        </div>
        {currentPosition ? (
          <div className="recommend-card">
            <span />
            <p>当前推荐学习</p>
            <h2>{currentPosition.section.title}</h2>
            <button
              className="primary-pill"
              onClick={() => onOpenSection(project, currentPosition.chapter.id, currentPosition.section.id)}
            >
              继续学习
            </button>
          </div>
        ) : (
          <div className="recommend-card">
            <span />
            <p>项目内容</p>
            <h2>尚未添加章节</h2>
            <button className="primary-pill" disabled>暂无可学习内容</button>
          </div>
        )}
      </section>
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
  const [content, setContent] = useState<LessonContent | null>(
    section.content ?? null,
  );
  const [isGenerating, setIsGenerating] = useState(!section.content);
  const [generationError, setGenerationError] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);
  const [tutorInput, setTutorInput] = useState("");
  const [isTutorThinking, setIsTutorThinking] = useState(false);
  const [tutorMessages, setTutorMessages] = useState<
    Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      error?: boolean;
    }>
  >([]);
  const lessonRequestId = useRef(0);
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
  const previousSection =
    currentSectionIndex > 0 ? sectionPositions[currentSectionIndex - 1] : null;
  const nextSection =
    currentSectionIndex >= 0 &&
    currentSectionIndex < sectionPositions.length - 1
      ? sectionPositions[currentSectionIndex + 1]
      : null;

  useEffect(() => {
    const requestId = ++lessonRequestId.current;
    setContent(section.content ?? null);
    setGenerationError("");
    setTutorInput("");
    setTutorMessages([
      {
        id: `intro-${section.id}`,
        role: "assistant",
        content: `你好，我是这一节的 AI 助教。课程内容生成后，我会结合《${section.title}》的上下文为你解释、举例和出题。`,
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
    const thread = chatThreadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [tutorMessages, isTutorThinking]);

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
        title: "本节内容已重新生成",
        description: `已使用 ${result.content.modelName} 更新讲解、示例和练习。`,
      });
    } catch (error) {
      if (lessonRequestId.current !== requestId) return;
      setGenerationError(getErrorMessage(error));
      notify({
        variant: "error",
        title: "课程内容生成失败",
        description: getErrorMessage(error),
      });
    } finally {
      if (lessonRequestId.current === requestId) setIsGenerating(false);
    }
  }

  async function sendTutorMessage(preset?: string) {
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
      );
      setTutorMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: result.answer,
        },
      ]);
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
  }

  async function markSectionComplete() {
    if (isCompleting || section.status === "done") return;
    setIsCompleting(true);
    try {
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
      <section className="classroom-top">
        <button className="icon-button" onClick={onBack} aria-label="返回">←</button>
        <div>
          <span>{project.title}</span>
          <strong>{chapter.title} · {section.title}</strong>
        </div>
        <div className="lesson-generation-meta">
          <i className={isGenerating ? "is-working" : ""} />
          <span>
            {isGenerating
              ? "内容 Agent 正在生成"
              : content
                ? `由 ${content.modelName} 生成`
                : "等待生成"}
          </span>
        </div>
      </section>

      <div className="classroom-layout">
        <aside className="course-drawer">
          <h2>课程目录</h2>
          <CourseTree project={project} onOpenSection={onOpenSection} />
        </aside>

        <section className="lesson-content">
          <div className="lesson-content-toolbar">
            <div>
              <span>AI 课程内容</span>
              <strong>{section.title}</strong>
            </div>
            <button
              className="soft-pill"
              disabled={isGenerating}
              onClick={regenerateLesson}
            >
              {isGenerating ? "正在生成…" : content ? "重新生成" : "开始生成"}
            </button>
          </div>

          {isGenerating ? (
            <section className="lesson-generation-state" aria-live="polite">
              <div className="generation-orbit">
                <span />
                <i />
              </div>
              <div>
                <p>课程内容 Agent</p>
                <h2>正在把大纲展开成完整的一节课</h2>
                <span>组织知识关系 · 编写讲解 · 设计示例 · 生成练习</span>
              </div>
            </section>
          ) : null}

          {!isGenerating && generationError ? (
            <section className="lesson-error-state" role="alert">
              <span>!</span>
              <div>
                <strong>本节内容还没有生成</strong>
                <p>{generationError}</p>
              </div>
              <button className="primary-pill" onClick={regenerateLesson}>
                重试生成
              </button>
            </section>
          ) : null}

          {!isGenerating && content ? (
            <>
              <Card title="本节思维导图">
                <p className="lesson-overview">{content.overview}</p>
                <div className="mind-map mind-map--generated">
                  <strong>{content.mindMap.center}</strong>
                  <div className="mind-map-branches">
                    {content.mindMap.branches.map((branch, branchIndex) => (
                      <article key={`${branch.title}-${branchIndex}`}>
                        <span>{branch.title}</span>
                        <ul>
                          {branch.details.map((detail, detailIndex) => (
                            <li key={`${detail}-${detailIndex}`}>{detail}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>
                </div>
              </Card>

              <Card title="本节核心讲解">
                <p className="explanation-lead">{content.explanation.lead}</p>
                <div className="explanation-copy">
                  {content.explanation.paragraphs.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
                <div className="key-point-grid">
                  {content.explanation.keyPoints.map((point, index) => (
                    <div key={index}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <p>{point}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="本节示例">
                <div className="example-heading">
                  <span>完整示例</span>
                  <h3>{content.example.title}</h3>
                  <p>{content.example.scenario}</p>
                </div>
                <ol className="example-steps">
                  {content.example.steps.map((step, index) => (
                    <li key={index}>
                      <span>{index + 1}</span>
                      <p>{step}</p>
                    </li>
                  ))}
                </ol>
                {content.example.code ? (
                  <pre className="lesson-code">
                    <code>{content.example.code}</code>
                  </pre>
                ) : null}
                <div className="example-result">
                  <span>验证结果</span>
                  <p>{content.example.result}</p>
                </div>
              </Card>

              <PracticeCard
                exercise={content.exercise}
                sectionId={section.id}
              />
            </>
          ) : null}
        </section>

        <aside className="ai-chat">
          <div className="ai-chat-heading">
            <div>
              <span className="ai-status-dot" />
              <p>基于当前小节</p>
            </div>
            <h2>AI 助教</h2>
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
                <div className="thinking-dots" aria-label="AI 助教正在思考">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ) : null}
          </div>
          <div className="prompt-chips">
            {["再讲简单点", "给我出一道题", "举个例子", "总结本节"].map(
              (prompt) => (
                <button
                  disabled={isTutorThinking}
                  key={prompt}
                  onClick={() => sendTutorMessage(prompt)}
                >
                  {prompt}
                </button>
              ),
            )}
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
      </div>

      <nav className="lesson-nav">
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
          上一节
        </button>
        <button
          disabled={isCompleting || section.status === "done"}
          onClick={markSectionComplete}
        >
          {section.status === "done"
            ? "已完成"
            : isCompleting
              ? "保存中…"
              : "标记完成"}
        </button>
        <button
          disabled={!nextSection}
          onClick={() =>
            nextSection &&
            onOpenSection(
              project,
              nextSection.chapterId,
              nextSection.sectionId,
            )
          }
        >
          下一节
        </button>
        <button onClick={onBack}>回到目录</button>
      </nav>
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
      <section className="settings-hero">
        <button className="icon-button" onClick={onCancel} aria-label="返回">←</button>
        <div>
          <p>设置</p>
          <h1>AI 服务配置</h1>
          <span>当前服务商：DeepSeek</span>
        </div>
      </section>

      <section className="settings-grid">
        <Card title="DeepSeek">
          <label>
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
            Base URL
            <input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
          </label>
          <label>
            模型
            <select
              value={draft.modelName}
              disabled={isLoadingModels || models.length === 0}
              onChange={(event) =>
                setDraft({ ...draft, modelName: event.target.value })
              }
            >
              {isLoadingModels ? <option value="">正在从官网获取模型…</option> : null}
              {!isLoadingModels && models.length === 0 ? (
                <option value={draft.modelName}>
                  {draft.modelName || "请先获取官方模型"}
                </option>
              ) : null}
              {models.map((model) => (
                <option value={model.id} key={model.id}>{model.id}</option>
              ))}
            </select>
            <small className={modelLoadError ? "settings-hint settings-hint--error" : "settings-hint"}>
              {modelLoadError
                ? modelLoadError
                : models.length
                  ? `来自 DeepSeek 官方接口 · ${models.length} 个可用模型`
                  : "模型列表不会写死，由 DeepSeek 官方接口返回。"}
            </small>
          </label>
          <div className="button-row">
            <button
              className="soft-pill"
              disabled={isLoadingModels}
              onClick={handleRefreshModels}
            >
              {isLoadingModels ? "正在获取…" : "刷新官方模型"}
            </button>
            <button
              className="soft-pill"
              disabled={isTesting || !draft.modelName}
              onClick={handleTestConnection}
            >
              {isTesting ? "正在测试…" : "测试连接"}
            </button>
            <button
              className="primary-pill"
              disabled={isSaving || !draft.modelName}
              onClick={handleSave}
            >
              {isSaving ? "正在保存…" : "保存配置"}
            </button>
          </div>
        </Card>

        <Card title="Web Search · Tavily">
          <label>
            Tavily API Key
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
          <div className="button-row">
            <button
              className="soft-pill"
              disabled={isTestingSearch}
              onClick={handleTestSearch}
            >
              {isTestingSearch ? "正在检索…" : "测试 Web Search"}
            </button>
          </div>
        </Card>

        <Card title="AI 使用场景">
          {["创建项目时生成大纲", "大纲预览页润色手动新增节点", "课程中心生成讲解", "课程中心生成思维导图", "课程中心生成示例", "课程中心生成练习题", "AI 助教聊天答疑"].map((item) => (
            <label className="toggle-row" key={item}>
              {item}
              <input type="checkbox" defaultChecked />
            </label>
          ))}
        </Card>

        <Card title="AI 行为偏好">
          <SelectRow label="讲解深度" value={draft.explanationDepth} options={["简单", "标准", "深入"]} onChange={(value) => setDraft({ ...draft, explanationDepth: value as ModelSettings["explanationDepth"] })} />
          <SelectRow label="题目难度" value={draft.questionDifficulty} options={["基础", "提高", "综合"]} onChange={(value) => setDraft({ ...draft, questionDifficulty: value as ModelSettings["questionDifficulty"] })} />
          <SelectRow label="回答长度" value={draft.answerLength} options={["简短", "适中", "详细"]} onChange={(value) => setDraft({ ...draft, answerLength: value as ModelSettings["answerLength"] })} />
        </Card>
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
            <button key={section.id} className={`tree-section tree-section--${section.status}`} onClick={() => onOpenSection(project, chapter.id, section.id)}>
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

function PracticeCard({
  exercise,
  sectionId,
}: {
  exercise: LessonContent["exercise"];
  sectionId: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setSelected(null);
    setSubmitted(false);
  }, [sectionId, exercise.question]);

  return (
    <Card title="练习互动区">
      <p className="question">{exercise.question}</p>
      <div className="options">
        {exercise.options.map((option, optionIndex) => {
          const isSelected = selected === optionIndex;
          const isCorrect = submitted && optionIndex === exercise.answerIndex;
          const isWrong = submitted && isSelected && !isCorrect;
          return (
            <button
              className={[
                isSelected ? "selected" : "",
                isCorrect ? "correct" : "",
                isWrong ? "wrong" : "",
              ].join(" ")}
              disabled={submitted}
              key={`${option}-${optionIndex}`}
              onClick={() => setSelected(optionIndex)}
            >
              <span>
                {String.fromCharCode(65 + optionIndex)}. {option}
              </span>
              <i />
            </button>
          );
        })}
      </div>
      {submitted ? (
        <div
          className={`answer-feedback ${selected === exercise.answerIndex ? "answer-feedback--correct" : "answer-feedback--wrong"}`}
          role="status"
        >
          <strong>
            {selected === exercise.answerIndex ? "回答正确" : "再想一步"}
          </strong>
          <p>{exercise.explanation}</p>
        </div>
      ) : null}
      <div className="button-row">
        <button
          className="primary-pill"
          disabled={selected === null || submitted}
          onClick={() => setSubmitted(true)}
        >
          提交答案
        </button>
        {submitted ? (
          <button
            className="soft-pill"
            onClick={() => {
              setSelected(null);
              setSubmitted(false);
            }}
          >
            再做一次
          </button>
        ) : null}
      </div>
    </Card>
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
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
