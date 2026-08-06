import { useState } from "react";
import type {
  CourseChapter,
  LearningProject,
} from "../../studyAgent";

const difficultyLabels = ["", "入门", "基础", "进阶", "高级", "综合"];
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
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUserAddedOutlineNode(node: {
  id: string;
  origin?: "ai" | "user";
}) {
  return node.origin === "user" || (!node.origin && uuidPattern.test(node.id));
}


export default function OutlinePage({
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
