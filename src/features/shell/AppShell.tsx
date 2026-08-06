import type { GenerationTask } from "../../api";
import { useSmoothProgress } from "../generation/useSmoothProgress";

export type MainView = "home" | "plan" | "review" | "stats";
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

function getScopedStorageKey(name: string) {
  const userId =
    typeof window !== "undefined" ? localStorage.getItem("app_user_id") : null;
  return userId ? `${name}:${userId}` : name;
}

function GlobalTaskItem({ task }: { task: GenerationTask }) {
  const progressValue = useSmoothProgress(task);
  const itemProgress = task.status === "completed" ? 100 : progressValue;

  return (
    <article className={`generation-task generation-task--${task.status}`} key={task.id}>
      <span className="generation-task-mark" aria-hidden="true" />
      <div>
        <strong>{task.title}</strong>
        <p>{task.stage}</p>
        {task.detail ? <small>{task.detail}</small> : null}
        {task.error ? <small className="task-error">{task.error}</small> : null}
        <div className="generation-task-track" aria-hidden="true">
          <i style={{ width: `${itemProgress}%` }} />
        </div>
      </div>
      <em>
        {task.status === "completed"
          ? "完成"
          : task.status === "failed"
            ? "失败"
            : task.status === "queued"
              ? "等待"
              : `${itemProgress}%`}
      </em>
    </article>
  );
}

export function GlobalTopBar({
  tasks,
  onHome,
  onSettings,
  resolvedTheme,
  themePreference,
  onThemeChange,
}: {
  tasks: GenerationTask[];
  onHome: () => void;
  onSettings: () => void;
  resolvedTheme: ResolvedTheme;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const maxCount = typeof window !== "undefined" ? Number(localStorage.getItem(getScopedStorageKey("app_task_max_count")) || "10") : 10;
  const retentionMins = typeof window !== "undefined" ? Number(localStorage.getItem(getScopedStorageKey("app_task_retention_minutes")) || "10") : 10;

  const now = Date.now();
  const filteredTasks = tasks.filter((task) => {
    if (task.status === "running" || task.status === "queued") return true;
    if (retentionMins === 0) return true;
    const taskTime = new Date(task.updatedAt || task.createdAt).getTime();
    return now - taskTime <= retentionMins * 60 * 1000;
  });

  const visibleTasks = filteredTasks.slice(0, maxCount);
  const activeTasks = tasks.filter(
    (task) => task.status === "running" || task.status === "queued",
  );
  const primaryTask = activeTasks[0];
  const primaryProgress = useSmoothProgress(primaryTask);

  return (
    <header className="global-bar">
      <button className="brand-dot" onClick={onHome} aria-label="返回首页">
        <img src="/icons/icon-192.svg" alt="" width="28" height="28" />
        <span className="brand-wordmark">
          <strong>求知场</strong>
          <small translate="no">Learning Studio</small>
        </span>
      </button>
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
          {primaryTask ? (
            <em>{primaryProgress}%</em>
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
                <GlobalTaskItem key={task.id} task={task} />
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
        {typeof window !== "undefined" && (
          <button
            type="button"
            className="user-profile-badge"
            title="点击管理个人中心与账号"
            aria-label="打开个人中心与账号设置"
            onClick={onSettings}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "4px 10px 4px 6px",
              borderRadius: "14px",
              background: "var(--color-surface-muted)",
              border: "1px solid var(--color-border)",
              cursor: "pointer",
              fontSize: "0.88rem",
              fontWeight: 500,
              color: "var(--color-text)",
              transition: "background-color 0.2s ease, border-color 0.2s ease",
            }}
          >
            <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>{localStorage.getItem("app_avatar") || "🦄"}</span>
            <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {(() => {
                const nick = localStorage.getItem("app_nickname");
                if (nick && nick.trim()) return nick.trim();
                const u = localStorage.getItem("app_username");
                if (u && u !== "已登录") return u;
                if (localStorage.getItem("app_token")) return "学习者";
                return "未登录";
              })()}
            </span>
          </button>
        )}
        <button className="icon-button" onClick={onSettings} aria-label="设置">⚙</button>
        <ThemeControl
          onChange={onThemeChange}
          preference={themePreference}
          resolvedTheme={resolvedTheme}
        />
      </div>
    </header>
  );
}

function ThemeControl({
  onChange,
  preference,
  resolvedTheme,
}: {
  onChange: (theme: ThemePreference) => void;
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
}) {
  const labels: Record<ThemePreference, string> = {
    system: "跟随系统",
    light: "浅色",
    dark: "深色",
  };
  const icons: Record<ThemePreference, string> = {
    system: "◐",
    light: "☼",
    dark: "☾",
  };

  return (
    <details className="theme-control">
      <summary
        className="icon-button"
        aria-label={`主题：${labels[preference]}，当前为${resolvedTheme === "dark" ? "深色" : "浅色"}`}
        title={`主题：${labels[preference]}`}
      >
        {icons[preference]}
      </summary>
      <div className="theme-menu">
        <header>
          <span>阅读主题</span>
          <small>当前为{resolvedTheme === "dark" ? "深色" : "浅色"}</small>
        </header>
        {(["system", "light", "dark"] as ThemePreference[]).map((theme) => (
          <button
            className={preference === theme ? "is-active" : ""}
            key={theme}
            onClick={(event) => {
              onChange(theme);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <i aria-hidden="true">{icons[theme]}</i>
            <span>
              <strong>{labels[theme]}</strong>
              <small>
                {theme === "system"
                  ? "随设备明暗自动变化"
                  : theme === "light"
                    ? "明亮、清晰的学习桌面"
                    : "低亮度的专注阅读环境"}
              </small>
            </span>
            <em aria-hidden="true">{preference === theme ? "✓" : ""}</em>
          </button>
        ))}
      </div>
    </details>
  );
}

export function FloatingNav({
  activeView,
  onNavigate,
}: {
  activeView: MainView;
  onNavigate: (view: MainView) => void;
}) {
  const navItems: Array<{ view: MainView; label: string; icon: string }> = [
    { view: "home", label: "首页", icon: "⌂" },
    { view: "plan", label: "计划", icon: "◷" },
    { view: "review", label: "复习", icon: "↻" },
    { view: "stats", label: "统计", icon: "◎" },
  ];

  return (
    <nav className="floating-nav" aria-label="主要导航">
      {navItems.map((item) => (
        <button
          className={activeView === item.view ? "active" : ""}
          key={item.view}
          onClick={() => onNavigate(item.view)}
        >
          <span aria-hidden="true">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

