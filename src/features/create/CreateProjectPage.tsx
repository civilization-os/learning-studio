import { useEffect, useState } from "react";
import {
  generateRemoteProjectDescription,
  getRemoteAiSettings,
  getRemotePreferenceRecommendations,
} from "../../api";
import { useToast } from "../../components/ui/toast";
import { preferenceQuestions } from "../../preferenceConfig";
import type {
  OutlinePreferences,
  PreferenceRecommendations,
} from "../../studyAgent";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "发生未知错误";
}


export default function CreateProjectPage({
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
      const aiSettings = await getRemoteAiSettings();
      if (!aiSettings.apiKeyConfigured) return;
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
      <main className="center-page center-page--wide create-page preference-page">
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
    <main className="center-page create-page">
      <section className="form-card">
        <div className="form-head">
          <button className="icon-button" onClick={onCancel} aria-label="返回">←</button>
          <h1>创建项目</h1>
          <span />
        </div>
        <label>
          课题名称
          <input
            name="project-topic"
            autoComplete="off"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="例如：古诗文背诵"
          />
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
            name="project-description"
            autoComplete="off"
            value={description}
            aria-busy={isGeneratingDescription}
            readOnly={isGeneratingDescription}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={
              topic.trim()
                ? "可以手动填写，也可以根据课题名称自动补充…"
                : "例如：每天背诵 3 首，整理意象并记录感悟…"
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
          aria-label={customPlaceholder}
          autoComplete="off"
          maxLength={240}
          value={value.custom}
          onChange={(event) => onChange({ custom: event.target.value })}
          placeholder={customPlaceholder}
        />
      ) : null}
    </fieldset>
  );
}

