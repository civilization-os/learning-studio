import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  createRemoteProject,
  deleteRemoteProject,
  generateRemoteOutline,
  getRemoteProjects,
  saveRemoteOutline,
  subscribeGenerationTasks,
  updateRemoteAiSettings,
  updateRemoteSearchSettings,
  type AuthResult,
  type GenerationTask,
} from "./api";
import { useToast } from "./components/ui/toast";
import { AuthScreens } from "./components/auth/AuthScreens";
import {
  EmptyProjectPage,
  HomePage,
  PlanPage,
  ReviewPage,
  StatsPage,
} from "./features/dashboard/DashboardPages";
import {
  CourseChapter,
  createProjectFromGoal,
  LearningProject,
  OutlinePreferences,
  StudyState,
} from "./studyAgent";
import { loadStudyState, saveStudyState } from "./storage";
import {
  FloatingNav,
  GlobalTopBar,
  type MainView,
  type ResolvedTheme,
  type ThemePreference,
} from "./features/shell/AppShell";
import { useSmoothProgress } from "./features/generation/useSmoothProgress";

type AppView = MainView | "create" | "generating" | "outline" | "detail" | "classroom" | "settings";

const themeStorageKey = "learning-studio-theme";
const SettingsPage = lazy(() => import("./features/settings/SettingsPage"));
const CreateProjectPage = lazy(() => import("./features/create/CreateProjectPage"));
const OutlinePage = lazy(() => import("./features/outline/OutlinePage"));
const CourseDetailPage = lazy(() => import("./features/course/CourseDetailPage"));
const ClassroomPage = lazy(() => import("./features/classroom/ClassroomPage"));

function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(themeStorageKey);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
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

function reconcileProjects(
  cachedState: StudyState,
  projects: LearningProject[],
): StudyState {
  const activeProject =
    projects.find((project) => project.id === cachedState.activeProjectId) ??
    projects[0];
  const activePosition = activeProject
    ? getFirstCoursePosition(activeProject)
    : null;
  const activeChapter = activeProject?.chapters.find(
    (chapter) => chapter.id === cachedState.activeChapterId,
  );
  const activeSection = activeChapter?.sections.find(
    (section) => section.id === cachedState.activeSectionId,
  );

  return {
    ...cachedState,
    projects,
    activeProjectId: activeProject?.id ?? "",
    activeChapterId: activeChapter?.id ?? activePosition?.chapter.id ?? "",
    activeSectionId: activeSection?.id ?? activePosition?.section.id ?? "",
  };
}

function RouteLoading({ label }: { label: string }) {
  return (
    <main className="session-loading" aria-live="polite" aria-busy="true">
      <img src="/icons/icon-192.svg" alt="" width="48" height="48" />
      <p>{label}</p>
    </main>
  );
}

// Keep this module focused on session and route orchestration.
export default function App() {
  const { notify } = useToast();
  const [authToken, setAuthToken] = useState<string | null>(() =>
    typeof window !== "undefined" && localStorage.getItem("app_user_id")
      ? localStorage.getItem("app_token")
      : null,
  );
  const [authUserId, setAuthUserId] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem("app_user_id") : null,
  );
  const [isSessionLoading, setIsSessionLoading] = useState(
    Boolean(authToken && authUserId),
  );
  const [state, setState] = useState<StudyState>(() =>
    loadStudyState(
      typeof window !== "undefined" ? localStorage.getItem("app_user_id") : null,
    ),
  );
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(readThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([]);
  const [view, setView] = useState<AppView>("home");
  const [draftProject, setDraftProject] = useState<LearningProject | null>(null);
  const [outlineReturnView, setOutlineReturnView] = useState<"create" | "detail">(
    "create",
  );
  const [projectPendingDeletion, setProjectPendingDeletion] =
    useState<LearningProject | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [, setProfileRevision] = useState(0);

  useEffect(() => {
    let lastToastTime = 0;
    const handleUnauthorized = () => {
      setAuthToken(null);
      setAuthUserId(null);
      setIsSessionLoading(false);
      setState(loadStudyState());
      setGenerationTasks([]);
      setDraftProject(null);
      setView("home");
      const now = Date.now();
      if (now - lastToastTime > 5000) {
        lastToastTime = now;
        notify({
          variant: "error",
          title: "登录过期或未授权",
          description: "您的登录凭证已失效，请重新登录。",
        });
      }
    };

    const handleLogout = () => {
      setAuthToken(null);
      setAuthUserId(null);
      setIsSessionLoading(false);
      setState(loadStudyState());
      setGenerationTasks([]);
      setDraftProject(null);
      setView("home");
      notify({
        variant: "success",
        title: "已成功退出登录",
        description: "您已安全退出当前账号，期待您的下次学习！",
      });
    };

    window.addEventListener("auth_unauthorized", handleUnauthorized);
    window.addEventListener("auth_logout", handleLogout);
    return () => {
      window.removeEventListener("auth_unauthorized", handleUnauthorized);
      window.removeEventListener("auth_logout", handleLogout);
    };
  }, [notify]);

  useEffect(() => {
    const refreshProfile = () => setProfileRevision((revision) => revision + 1);
    window.addEventListener("profile_updated", refreshProfile);
    window.addEventListener("local_preferences_updated", refreshProfile);
    return () => {
      window.removeEventListener("profile_updated", refreshProfile);
      window.removeEventListener("local_preferences_updated", refreshProfile);
    };
  }, []);

  useEffect(() => {
    if (!authToken || !authUserId) {
      setIsSessionLoading(false);
      return;
    }
    let cancelled = false;
    const cachedState = loadStudyState(authUserId);
    setIsSessionLoading(true);
    void getRemoteProjects()
      .then((projects) => {
        if (!cancelled) setState(reconcileProjects(cachedState, projects));
      })
      .catch((error) => {
        if (cancelled) return;
        setState(cachedState);
        notify({
          variant: "warning",
          title: "云端项目暂未同步",
          description: `${getErrorMessage(error)}；当前显示此账号的本地缓存。`,
        });
      })
      .finally(() => {
        if (!cancelled) setIsSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authToken, authUserId, notify]);

  useEffect(() => {
    if (!isSessionLoading) saveStudyState(authUserId, state);
  }, [authUserId, isSessionLoading, state]);

  const resolvedTheme: ResolvedTheme =
    themePreference === "system"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : themePreference;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    setSystemPrefersDark(media.matches);
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    window.localStorage.setItem(themeStorageKey, themePreference);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolvedTheme === "dark" ? "#111715" : "#f3f0e8");
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    if (!authToken || !authUserId) {
      setGenerationTasks([]);
      return;
    }
    return subscribeGenerationTasks(setGenerationTasks);
  }, [authToken, authUserId]);

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
  const activeGenerationTasks = generationTasks.filter(
    (task) => task.status === "running" || task.status === "queued",
  );
  const currentGenerationTask = activeGenerationTasks[0] ?? generationTasks.find((t) => t.status === "running" || t.status === "queued");

  if (!authToken || !authUserId) {
    return (
      <AuthScreens
        onAuthenticated={(session: AuthResult) => {
          setState(loadStudyState(session.userId));
          setAuthUserId(session.userId);
          setAuthToken(session.token);
          setIsSessionLoading(true);
          setView("home");
        }}
      />
    );
  }

  if (isSessionLoading) {
    return (
      <main className="session-loading" aria-live="polite" aria-busy="true">
        <img src="/icons/icon-192.svg" alt="" width="56" height="56" />
        <h1>正在同步学习空间</h1>
        <p>正在加载此账号的课程、进度与设置…</p>
      </main>
    );
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <GlobalTopBar
        tasks={generationTasks}
        onHome={() => go("home")}
        onSettings={() => go("settings")}
        resolvedTheme={resolvedTheme}
        themePreference={themePreference}
        onThemeChange={setThemePreference}
      />

      <div id="main-content" className="workspace" tabIndex={-1}>
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
      {view === "create" && (
        <Suspense fallback={<RouteLoading label="正在加载创建流程…" />}>
          <CreateProjectPage onCancel={() => go("home")} onCreate={startCreate} />
        </Suspense>
      )}
      {view === "generating" && <GeneratingPage task={currentGenerationTask} />}
      {view === "outline" && draftProject && (
        <Suspense fallback={<RouteLoading label="正在加载大纲编辑器…" />}>
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
        </Suspense>
      )}
      {view === "detail" && activeProject && (
        <Suspense fallback={<RouteLoading label="正在加载课程详情…" />}>
          <CourseDetailPage
            project={activeProject}
            onOpenSection={openSection}
            onEditOutline={editProjectOutline}
            onProjectUpdate={updateProject}
            onBack={() => go("home")}
          />
        </Suspense>
      )}
      {view === "classroom" && activeProject && activeChapter && activeSection && (
        <Suspense fallback={<RouteLoading label="正在加载互动课堂…" />}>
          <ClassroomPage
            project={activeProject}
            chapter={activeChapter}
            section={activeSection}
            onBack={() => go("detail")}
            onOpenSection={openSection}
            onProjectUpdate={updateProject}
          />
        </Suspense>
      )}
      {view === "settings" && (
        <Suspense fallback={<RouteLoading label="正在加载设置中心…" />}>
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
        </Suspense>
      )}
      </div>

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



function GeneratingPage({ task }: { task?: GenerationTask }) {
  const displayProgress = useSmoothProgress(task);

  return (
    <main className="center-page generating-page">
      <section className="generating-card">
        <div className="orbit-loader"><span /><span /><span /></div>
        <span className="generating-eyebrow">
          {task?.status === "queued" ? "即将开始" : "课程正在准备"}
        </span>
        <h1>{task?.stage ?? "正在建立生成任务"}</h1>
        <p>
          {task?.detail ??
            "服务端正在处理生成请求，进度实时同步中…"}
        </p>
        <div className="generating-progress" aria-label={`当前进度 ${displayProgress}%`}>
          <i style={{ width: `${displayProgress}%`, transition: "width 0.3s ease" }} />
        </div>
        <div className="generating-readout">
          <span>{task?.title ?? "生成学习路线"}</span>
          <strong>{displayProgress}%</strong>
        </div>
      </section>
    </main>
  );
}

// End of route orchestration module.
