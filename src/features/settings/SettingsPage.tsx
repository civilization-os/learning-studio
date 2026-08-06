import { useEffect, useId, useRef, useState } from "react";
import {
  getRemoteAiSettings,
  getRemoteModels,
  getRemoteSearchSettings,
  logoutLocal,
  testRemoteAiConnection,
  testRemoteSearchConnection,
  updateRemoteAiSettings,
  updateUserProfileRemote,
  type RemoteModel,
} from "../../api";
import { useToast } from "../../components/ui/toast";
import type { ModelSettings } from "../../studyAgent";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "发生未知错误";
}

function getScopedStorageKey(name: string) {
  const userId =
    typeof window !== "undefined" ? localStorage.getItem("app_user_id") : null;
  return userId ? `${name}:${userId}` : name;
}

function UserProfileSettingsCard() {
  const { notify } = useToast();
  const [username] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("app_username") || "学习者" : "学习者"));
  const [nickname, setNickname] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("app_nickname") || "" : ""));
  const [avatar, setAvatar] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("app_avatar") || "🦄" : "🦄"));
  const [isSaving, setIsSaving] = useState(false);

  const avatars = ["🐶", "🐱", "🦊", "🐼", "🐰", "🦁", "🦉", "🦄"];

  const handleSaveProfile = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await updateUserProfileRemote({
        nickname: nickname.trim(),
        avatar,
      });
      localStorage.setItem("app_avatar", avatar);
      if (nickname.trim()) {
        localStorage.setItem("app_nickname", nickname.trim());
      } else {
        localStorage.removeItem("app_nickname");
      }
      notify({
        variant: "success",
        title: "个人资料已同步入库",
        description: "您的昵称与头像已成功保存至后端数据库。",
      });
      window.dispatchEvent(new Event("profile_updated"));
    } catch (err: unknown) {
      notify({
        variant: "error",
        title: "保存失败",
        description: err instanceof Error ? err.message : "更新个人资料失败，请重试。",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="panel-card settings-card" style={{ gridColumn: "1 / -1", marginBottom: "12px" }}>
      <div className="settings-card-head">
        <div>
          <span>个人中心</span>
          <h2>个人资料与账号</h2>
          <p>修改个人昵称、专属头像，或进行账号安全管理。</p>
        </div>
        <button
          className="soft-pill"
          type="button"
          onClick={() => logoutLocal()}
          style={{ color: "var(--color-danger, #ef4444)", borderColor: "rgba(239, 68, 68, 0.25)" }}
        >
          退出当前账号
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label htmlFor="profile-username" style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--color-text)" }}>用户名（登录账号，只读）</label>
          <input
            id="profile-username"
            name="username"
            type="text"
            value={username}
            disabled
            style={{
              padding: "10px 14px",
              borderRadius: "12px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-subtle)",
              color: "var(--color-text-muted)",
              fontSize: "0.92rem",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label htmlFor="profile-nickname" style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--color-text)" }}>个性昵称（选填）</label>
          <input
            id="profile-nickname"
            name="nickname"
            type="text"
            autoComplete="nickname"
            maxLength={40}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="请输入个性昵称（留空使用用户名）"
            style={{
              padding: "10px 14px",
              borderRadius: "12px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-raised)",
              color: "var(--color-text)",
              fontSize: "0.92rem",
            }}
          />
        </div>
      </div>

      <div style={{ marginTop: "16px" }}>
        <span style={{ display: "block", fontSize: "0.88rem", fontWeight: 600, color: "var(--color-text)", marginBottom: "8px" }}>专属头像</span>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {avatars.map((a) => (
            <button
              key={a}
              type="button"
              aria-label={`选择头像 ${a}`}
              aria-pressed={avatar === a}
              onClick={() => setAvatar(a)}
              style={{
                fontSize: "1.4rem",
                width: "42px",
                height: "42px",
                borderRadius: "12px",
                border: avatar === a ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
                background: avatar === a ? "var(--color-surface-accent)" : "transparent",
                cursor: "pointer",
                transition: "border-color 0.15s ease, background-color 0.15s ease",
              }}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
        <button className="primary-pill" type="button" disabled={isSaving} onClick={handleSaveProfile}>
          {isSaving ? "正在保存…" : "保存个人资料"}
        </button>
      </div>
    </section>
  );
}

function TaskSettingsCard() {
  const { notify } = useToast();
  const [maxCount, setMaxCount] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(getScopedStorageKey("app_task_max_count")) || "10" : "10"
  );
  const [retentionMins, setRetentionMins] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(getScopedStorageKey("app_task_retention_minutes")) || "10" : "10"
  );

  const handleSaveTaskSettings = () => {
    localStorage.setItem(getScopedStorageKey("app_task_max_count"), maxCount);
    localStorage.setItem(getScopedStorageKey("app_task_retention_minutes"), retentionMins);
    notify({
      variant: "success",
      title: "后台任务记录设置已保存",
      description: `显示上限为 ${maxCount} 条，完成记录保留 ${retentionMins === "0" ? "永久" : `${retentionMins}分钟`}。`,
    });
    window.dispatchEvent(new Event("local_preferences_updated"));
  };

  return (
    <section className="panel-card settings-card" style={{ gridColumn: "1 / -1", marginBottom: "12px" }}>
      <div className="settings-card-head">
        <div>
          <span>任务中心</span>
          <h2>后台任务记录设置</h2>
          <p>控制顶部生成任务中心显示上限与自动保留清理规则，避免积压过多历史记录。</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label htmlFor="task-max-count" style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--color-text)" }}>列表显示数量上限</label>
          <select
            id="task-max-count"
            name="task-max-count"
            value={maxCount}
            onChange={(e) => setMaxCount(e.target.value)}
            style={{
              padding: "10px 14px",
              borderRadius: "12px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-raised)",
              color: "var(--color-text)",
              fontSize: "0.92rem",
            }}
          >
            <option value="5">显示最多 5 条记录</option>
            <option value="10">显示最多 10 条记录（推荐）</option>
            <option value="20">显示最多 20 条记录</option>
            <option value="50">显示最多 50 条记录</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label htmlFor="task-retention" style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--color-text)" }}>完成/失败记录保留时长上限</label>
          <select
            id="task-retention"
            name="task-retention"
            value={retentionMins}
            onChange={(e) => setRetentionMins(e.target.value)}
            style={{
              padding: "10px 14px",
              borderRadius: "12px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-raised)",
              color: "var(--color-text)",
              fontSize: "0.92rem",
            }}
          >
            <option value="1">完成 1 分钟后自动移除</option>
            <option value="5">完成 5 分钟后自动移除</option>
            <option value="10">完成 10 分钟后自动移除（推荐）</option>
            <option value="30">完成 30 分钟后自动移除</option>
            <option value="60">完成 1 小时后自动移除</option>
            <option value="0">永久保留历史记录</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
        <button className="primary-pill" type="button" onClick={handleSaveTaskSettings}>
          保存任务记录规则
        </button>
      </div>
    </section>
  );
}

export default function SettingsPage({
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

    void Promise.allSettled([
      getRemoteAiSettings(),
      getRemoteSearchSettings(),
    ]).then(async ([aiResult, searchResult]) => {
        if (!active) return;

        let officialModels: RemoteModel[] = [];
        let modelsError = "";
        if (aiResult.status === "fulfilled" && aiResult.value.apiKeyConfigured) {
          try {
            officialModels = await getRemoteModels();
          } catch (error) {
            modelsError = getErrorMessage(error);
          }
        }
        if (!active) return;

        const officialIds = new Set(officialModels.map((model) => model.id));
        setModels(officialModels);
        setIsLoadingModels(false);
        setModelLoadError(modelsError);

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

  const [activeTab, setActiveTab] = useState<"profile" | "ai" | "search" | "learning" | "tasks">("profile");

  const tabs = [
    {
      id: "profile" as const,
      label: "个人资料",
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      ),
    },
    {
      id: "ai" as const,
      label: "AI 服务",
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      ),
    },
    {
      id: "search" as const,
      label: "联网检索",
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.3-4.3"/>
        </svg>
      ),
    },
    {
      id: "learning" as const,
      label: "学习偏好",
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
          <path d="M6.5 6H20"/>
        </svg>
      ),
    },
    {
      id: "tasks" as const,
      label: "任务与系统",
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      ),
    },
  ];

  return (
    <main className="page narrow settings-page">
      <section className="settings-hero settings-hero--refined">
        <button className="icon-button" onClick={onCancel} aria-label="返回">←</button>
        <div className="settings-hero-copy">
          <p>设置中心</p>
          <h1>服务与学习设置</h1>
          <span>调整个人资料、AI 生成模型、联网搜索以及后台任务规则。</span>
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

      {/* Categorized Tab Bar */}
      <nav className="settings-nav-tabs" style={{ display: "flex", gap: "8px", marginBottom: "20px", padding: "6px", background: "var(--color-surface-muted)", borderRadius: "16px", border: "1px solid var(--color-border)" }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab-btn ${isActive ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "10px 14px",
                borderRadius: "12px",
                border: "none",
                background: isActive ? "var(--color-surface-raised)" : "transparent",
                color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                fontWeight: isActive ? 700 : 500,
                boxShadow: isActive ? "var(--shadow-1)" : "none",
                cursor: "pointer",
                transition: "background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease",
                fontSize: "0.92rem",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center" }}>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="settings-grid settings-grid--refined">
        {activeTab === "profile" && <UserProfileSettingsCard />}
        {activeTab === "tasks" && <TaskSettingsCard />}

        {activeTab === "ai" && (
          <section className="panel-card settings-card settings-card--provider" style={{ gridColumn: "1 / -1" }}>
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
                name="deepseek-api-key"
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
              <input
                type="url"
                name="deepseek-base-url"
                autoComplete="off"
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
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
        )}

        {activeTab === "search" && (
          <section className="panel-card settings-card settings-card--search" style={{ gridColumn: "1 / -1" }}>
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
                name="tavily-api-key"
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
        )}

        {activeTab === "learning" && (
          <section className="panel-card settings-card settings-card--learning" style={{ gridColumn: "1 / -1" }}>
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
        )}
      </section>
    </main>
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

