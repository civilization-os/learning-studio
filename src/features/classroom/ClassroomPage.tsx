import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  askRemoteTutor,
  completeRemoteSection,
  generateRemoteChapterToolLibrary,
  generateRemoteLesson,
  generateRemoteVariantExercise,
  saveRemoteLessonProgress,
  type TutorHistoryItem,
  type TutorSceneContext,
} from "../../api";
import { MathText } from "../../components/shared/MathText";
import { useToast } from "../../components/ui/toast";
import { FlashCardSuite, VisualCanvasCard } from "../../components/visual/VisualCanvas";
import { InteractiveDemoList } from "../../components/visual/InteractiveDemoRenderer";
import type {
  ChapterToolLibrary,
  CourseChapter,
  ExerciseItem,
  LessonContent,
  LessonKnowledgeState,
  LessonProgress,
  LessonScene,
  LessonSceneEvidence,
  LessonSection,
  LearningProject,
} from "../../studyAgent";
import { ChapterToolLibraryDrawer } from "../course/ChapterToolLibraryDrawer";
import { LessonSceneFlow, PracticeCard } from "./LessonActivities";

const toolbookCategoryLabels = {
  formula: "公式",
  rule: "规则",
  checklist: "检查表",
  command: "命令",
  template: "模板",
  reference: "参照",
};

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

function LessonToolbookDrawer({
  isOpen,
  onClose,
  sectionTitle,
  toolbook,
}: {
  isOpen: boolean;
  onClose: () => void;
  sectionTitle: string;
  toolbook: NonNullable<LessonContent["toolbook"]>;
}) {
  const rememberCount = toolbook.items.filter(
    (item) => item.tier === "remember",
  ).length;

  return (
    <>
      <button
        className={`toolbook-backdrop ${isOpen ? "is-open" : ""}`}
        aria-label="关闭本节工具簿"
        tabIndex={isOpen ? 0 : -1}
        onClick={onClose}
      />
      <aside
        className={`lesson-toolbook ${isOpen ? "is-open" : ""}`}
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <header className="toolbook-header">
          <div>
            <span>SECTION FIELD NOTES</span>
            <small>{sectionTitle}</small>
            <h2>{toolbook.title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭本节工具簿"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="toolbook-scroll">
          <section className="toolbook-scope">
            <div>
              <span>{String(toolbook.items.length).padStart(2, "0")}</span>
              <small>项可查工具</small>
            </div>
            <p>{toolbook.scope}</p>
          </section>

          <div className="toolbook-index" aria-label="工具簿分类">
            <span>
              <strong>{rememberCount}</strong>
              必须记住
            </span>
            <span>
              <strong>{toolbook.items.length - rememberCount}</strong>
              用时查阅
            </span>
          </div>

          <div className="toolbook-list">
            {toolbook.items.map((item, index) => (
              <article
                className={`toolbook-item toolbook-item--${item.tier}`}
                key={`${item.title}-${index}`}
              >
                <header>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <small>
                      {toolbookCategoryLabels[item.category]} ·{" "}
                      {item.tier === "remember" ? "必须记住" : "用时查阅"}
                    </small>
                    <h3>{item.title}</h3>
                  </div>
                </header>
                <ul>
                  {item.content.map((entry, entryIndex) => (
                    <li key={`${entry}-${entryIndex}`}>
                      <MathText value={entry} />
                    </li>
                  ))}
                </ul>
                <dl>
                  <div>
                    <dt>什么时候用</dt>
                    <dd>
                      <MathText value={item.useWhen} />
                    </dd>
                  </div>
                  <div>
                    <dt>边界</dt>
                    <dd>
                      <MathText value={item.boundary} />
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <footer className="toolbook-completeness">
            <span>这份工具簿覆盖到哪里</span>
            <p>{toolbook.completenessNote}</p>
          </footer>
        </div>
      </aside>
    </>
  );
}

export default function ClassroomPage({
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
  type LearningPhase = "learn" | "practice" | "reflect";
  type PracticeResult = "idle" | "correct" | "incorrect";
  type Confidence = "uncertain" | "partial" | "ready";

  const phaseItems: Array<{
    id: LearningPhase;
    index: string;
    label: string;
    description: string;
  }> = [
    { id: "learn", index: "01", label: "学习", description: "先看地图，再逐步弄懂" },
    { id: "practice", index: "02", label: "做题", description: "用题目验证掌握" },
    { id: "reflect", index: "03", label: "回顾", description: "收束本节，排进复习" },
  ];
  const [content, setContent] = useState<LessonContent | null>(
    section.content ?? null,
  );
  const [isGenerating, setIsGenerating] = useState(!section.content);
  const [generationError, setGenerationError] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);
  const [tutorInput, setTutorInput] = useState("");
  const [isTutorThinking, setIsTutorThinking] = useState(false);
  const [activePhase, setActivePhase] = useState<LearningPhase>("learn");
  const [isCourseMapOpen, setIsCourseMapOpen] = useState(false);
  const [isToolbookOpen, setIsToolbookOpen] = useState(false);
  const [isChapterToolsLoading, setIsChapterToolsLoading] = useState(false);
  const [isCoachOpen, setIsCoachOpen] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(min-width: 1281px)").matches,
  );
  const [visitedPhases, setVisitedPhases] = useState<LearningPhase[]>(["learn"]);
  const [understandingComplete, setUnderstandingComplete] = useState(false);
  const [practiceResolved, setPracticeResolved] = useState(false);
  const [progressSaveState, setProgressSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [practiceResult, setPracticeResult] = useState<PracticeResult>("idle");
  const [practiceExerciseIndex, setPracticeExerciseIndex] = useState(0);
  const [practiceResults, setPracticeResults] = useState<boolean[]>([]);
  const [isVariantLoading, setIsVariantLoading] = useState(false);
  const [practiceItems, setPracticeItems] = useState<ExerciseItem[]>([]);
  const [isVariantItem, setIsVariantItem] = useState(false);
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
  const practiceExercises: ExerciseItem[] = useMemo(() => {
    if (!content) return [];
    if (content.exercises?.length) return content.exercises;
    if (content.exercise) {
      return [
        {
          type: "single-choice",
          knowledgePoint: "本节核心",
          question: content.exercise.question,
          options: content.exercise.options,
          answerIndex: content.exercise.answerIndex,
          explanation: content.exercise.explanation,
        },
      ];
    }
    return [];
  }, [content]);
  const currentPracticeExercise = practiceItems[practiceExerciseIndex];
  const practiceAllCorrect =
    practiceItems.length > 0 &&
    practiceResults.length === practiceItems.length &&
    practiceResults.every((correct) => correct);
  const practiceDone =
    practiceItems.length > 0 &&
    practiceResults.length === practiceItems.length;
  const reflectDone = reflectionText.trim().length >= 8;
  const isPhaseCompleted = (phase: LearningPhase) =>
    phase === "learn"
      ? understandingComplete
      : phase === "practice"
        ? practiceDone
        : reflectDone;
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
  const quickPrompts = Array.from(
    new Set(
      agentSuggestions.length
        ? agentSuggestions
        : activePhase === "learn"
          ? ["这张知识图怎么读", "本节最重要的关系是什么", "再讲简单点"]
          : activePhase === "practice"
            ? practiceResult === "idle"
              ? ["给我一级提示", "帮我排除一个选项", "提醒我用哪个概念"]
              : ["分析我的思路", "给我一道变式题", "让我解释为什么"]
            : ["用三个问题检验我", "总结我的薄弱点", "安排一次复习"],
    ),
  );
  const defaultRecommendation =
    practiceResult === "incorrect"
      ? "先弄清刚才容易混淆的地方，再试一道类似的题。"
      : practiceResult === "correct" && !confidence
        ? "这道题答对了。试着用自己的话说说为什么。"
        : activePhase === "learn"
          ? weakestKnowledge?.lastOutcome === "needs-review"
            ? `先用一个新例子重新判断“${weakestKnowledge.label}”，确认刚才的误区已经修正。`
            : "先看知识地图，再按提示完成每一步判断。"
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
    setActivePhase("learn");
    setVisitedPhases(["learn"]);
    setIsToolbookOpen(false);
    setUnderstandingComplete(false);
    setProgressSaveState("idle");
    setPracticeResult("idle");
    setPracticeResolved(false);
    setPracticeExerciseIndex(0);
    setPracticeResults([]);
    setIsVariantLoading(false);
    setPracticeItems(
      section.content?.exercises?.length
        ? section.content.exercises
        : section.content?.exercise
          ? [
              {
                type: "single-choice",
                knowledgePoint: "本节核心",
                question: section.content.exercise.question,
                options: section.content.exercise.options,
                answerIndex: section.content.exercise.answerIndex,
                explanation: section.content.exercise.explanation,
              },
            ]
          : [],
    );
    setIsVariantItem(false);
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isCourseMapOpen]);

  useEffect(() => {
    if (!isToolbookOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsToolbookOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isToolbookOpen]);

  useEffect(() => {
    if (!isCoachOpen || !window.matchMedia("(max-width: 1280px)").matches) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCoachOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isCoachOpen]);

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

  async function openChapterTools() {
    setIsCoachOpen(false);
    setIsCourseMapOpen(false);
    setIsToolbookOpen(true);
    if (chapter.toolLibrary || isChapterToolsLoading) return;
    setIsChapterToolsLoading(true);
    try {
      const result = await generateRemoteChapterToolLibrary(
        project.id,
        chapter.id,
      );
      onProjectUpdate(result.project);
      if (result.warning) {
        notify({
          variant: "warning",
          title: "本章工具已整理，部分资料未取得",
          description: result.warning,
        });
      }
    } catch (error) {
      setIsToolbookOpen(false);
      notify({
        variant: "error",
        title: "本章工具没有整理完成",
        description: getErrorMessage(error),
      });
    } finally {
      setIsChapterToolsLoading(false);
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
            aria-label="打开课程地图"
            aria-controls="classroom-course-map"
            aria-expanded={isCourseMapOpen}
            onClick={() => {
              setIsCoachOpen(false);
              setIsCourseMapOpen(true);
            }}
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
            aria-label={isCoachOpen ? "收起随堂助教" : "打开随堂助教"}
            aria-controls="classroom-coach"
            aria-expanded={isCoachOpen}
            onClick={() => {
              setIsCourseMapOpen(false);
              setIsCoachOpen((current) => !current);
            }}
          >
            <span className="classroom-coach-label classroom-coach-label--desktop">
              {isCoachOpen ? "收起助教" : "打开助教"}
            </span>
            <span
              className="classroom-coach-label classroom-coach-label--mobile"
              aria-hidden="true"
            >
              {isCoachOpen ? "收" : "问"}
            </span>
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

      <ChapterToolLibraryDrawer
        chapterTitle={chapter.title}
        currentSectionId={section.id}
        isLoading={isChapterToolsLoading}
        isOpen={isToolbookOpen}
        library={chapter.toolLibrary}
        projectSources={project.sources ?? []}
        onClose={() => setIsToolbookOpen(false)}
        onRefresh={async () => {
          if (isChapterToolsLoading) return;
          setIsChapterToolsLoading(true);
          try {
            const result = await generateRemoteChapterToolLibrary(
              project.id,
              chapter.id,
              true,
            );
            onProjectUpdate(result.project);
          } catch (error) {
            notify({
              variant: "error",
              title: "这次没有重新整理成功",
              description: getErrorMessage(error),
            });
          } finally {
            setIsChapterToolsLoading(false);
          }
        }}
      />

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
                  <strong>{phaseItems.length} 步</strong>
                </span>
                <span>
                  <small>当前进度</small>
                  <strong>{phaseProgress}%</strong>
                </span>
              </div>
              <button
                className={`toolbook-open-button ${chapter.toolLibrary ? "" : "is-pending"}`}
                disabled={isChapterToolsLoading}
                onClick={openChapterTools}
              >
                <span>本章工具</span>
                <strong>
                  {isChapterToolsLoading
                    ? "正在整理"
                    : chapter.toolLibrary
                      ? "按本节筛选"
                      : "需要时整理"}
                </strong>
                <i aria-hidden="true">
                  {chapter.toolLibrary ? "↗" : "＋"}
                </i>
              </button>
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
              const isCompleted = isPhaseCompleted(phase.id);
              return (
                <button
                  className={[
                    "learning-route-step",
                    isActive ? "is-active" : "",
                    isCompleted ? "is-visited" : "",
                  ].join(" ")}
                  aria-current={isActive ? "step" : undefined}
                  key={phase.id}
                  onClick={() => openPhase(phase.id)}
                >
                  <span>{isCompleted && !isActive ? "✓" : phase.index}</span>
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
              {activePhase === "learn" ? (
                <section className="learning-stage learning-stage--learn">
                  <div className="stage-intro">
                    <span>01 · 本节地图</span>
                    <h2>先看清本节要学什么</h2>
                    <p>{content.overview}</p>
                  </div>
                  {content.visualElements && content.visualElements.length > 0 && (
                    <div className="orient-visual-elements">
                      {content.visualElements.map((el, i) => (
                        <VisualCanvasCard key={i} element={el} />
                      ))}
                    </div>
                  )}
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

                  <InteractiveDemoList demos={content.interactiveDemos ?? []} />

                  {content.toolbook && content.toolbook.items && content.toolbook.items.length > 0 && (
                    <section className="lesson-toolbook-section" aria-label="随堂实战工具簿" style={{ marginTop: "2rem", marginBottom: "2rem", padding: "1.25rem", borderRadius: "16px", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", boxShadow: "var(--shadow-1)" }}>
                      <header className="inline-toolbook-header" style={{ marginBottom: "1.25rem", background: "transparent", border: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "flex-start" }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--color-accent-subtle)", padding: "2px 8px", borderRadius: "6px" }}>实战与速查工具簿</span>
                        <h3 style={{ fontSize: "1.2rem", fontWeight: 700, margin: "0.25rem 0", color: "var(--color-text)" }}>{content.toolbook.title || "随堂工具簿"}</h3>
                        <p style={{ fontSize: "0.88rem", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.5 }}>{content.toolbook.scope}</p>
                      </header>
                      <div className="toolbook-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
                        {content.toolbook.items.map((item, idx) => (
                          <article key={idx} className="toolbook-card" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: "999px", background: "var(--color-accent-subtle)", color: "var(--color-accent)", fontWeight: 600 }}>{item.category}</span>
                              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{item.tier === "remember" ? "★ 必记" : "🔍 查阅"}</span>
                            </div>
                            <h4 style={{ fontSize: "1rem", fontWeight: 600, margin: "0.25rem 0" }}>{item.title}</h4>
                            <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                              {item.content.map((c, ci) => (
                                <li key={ci}><MathText value={c} /></li>
                              ))}
                            </ul>
                            {item.useWhen && (
                              <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
                                💡 何时使用：{item.useWhen}
                              </div>
                            )}
                            {item.boundary && (
                              <div style={{ fontSize: "0.75rem", color: "var(--color-warning)", marginTop: "0.25rem" }}>
                                ⚠️ 边界提醒：{item.boundary}
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  <div className="stage-intro learn-scene-intro" style={{ marginTop: "2rem" }}>
                    <span>01 · 逐步弄懂</span>
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
                      带着刚才的判断去做题 <span>→</span>
                    </button>
                  ) : null}
                </section>
              ) : null}

              {activePhase === "practice" ? (
                <section className="learning-stage">
                  <div className="stage-intro">
                    <span>02 · 动手做题</span>
                    <h2>现在不看答案，独立做一次</h2>
                    <p>
                      {content.learningDesign?.successCriteria[0]
                        ? `这一题先验证：${content.learningDesign.successCriteria[0]}`
                        : "这些题可以帮你看看是否真的理解了。"}
                      卡住时可以要一个提示，但不会直接显示答案。
                    </p>
                  </div>
                  {practiceItems.length > 0 ? (
                    <>
                      <div className="practice-progress-bar" aria-label="练习进度">
                        <span>
                          第 {Math.min(practiceExerciseIndex + 1, practiceItems.length)} / {practiceItems.length} 题
                        </span>
                        <i>
                          <b
                            style={{
                              width: `${Math.round(((practiceResults.length + (practiceResults[practiceExerciseIndex] ? 1 : 0)) / practiceItems.length) * 100)}%`,
                            }}
                          />
                        </i>
                      </div>
                      <PracticeCard
                        exercise={currentPracticeExercise}
                        sectionId={section.id}
                        isVariant={isVariantItem}
                        onAskForHint={(level) =>
                          sendTutorMessage(
                            `请根据当前练习题给我第 ${level} 级提示，只缩小判断范围，不要公布答案。`,
                          )
                        }
                        onResult={({ correct, resolved }) => {
                          setPracticeResult(correct ? "correct" : "incorrect");
                          const currentCorrect = practiceResults[practiceExerciseIndex] ?? false;
                          if (correct || resolved) {
                            const next = [...practiceResults];
                            next[practiceExerciseIndex] = currentCorrect || correct;
                            setPracticeResults(next);
                          }
                          const allDone =
                            (correct || resolved) &&
                            practiceExerciseIndex >= practiceItems.length - 1;
                          setPracticeResolved(allDone);
                          setCoachRecommendation("");
                          setAgentSuggestions([]);
                        }}                        onRetry={() => {
                          setPracticeResult("idle");
                        }}
                        onRequestVariant={async () => {
                          if (isVariantLoading) return;
                          setIsVariantLoading(true);
                          try {
                            const result = await generateRemoteVariantExercise(
                              project.id,
                              section.id,
                              currentPracticeExercise,
                            );
                            const variant = result.data.first ?? result.data.questions[0];
                            if (variant) {
                              const next = [...practiceItems];
                              next[practiceExerciseIndex] = variant;
                              setPracticeItems(next);
                              setIsVariantItem(true);
                              setPracticeResult("idle");
                            }
                          } catch (error) {
                            notify({
                              variant: "error",
                              title: "变式题没有生成成功",
                              description: getErrorMessage(error),
                            });
                          } finally {
                            setIsVariantLoading(false);
                          }
                        }}
                        variantLoading={isVariantLoading}
                      />
                      {practiceResults[practiceExerciseIndex] && practiceExerciseIndex < practiceItems.length - 1 ? (
                        <button
                          className="stage-primary-action"
                          onClick={() => {
                            setPracticeExerciseIndex((index) => index + 1);
                            setPracticeResult("idle");
                            setIsVariantItem(false);
                          }}
                        >
                          下一题 <span>→</span>
                        </button>
                      ) : null}
                      {practiceResolved && practiceResults[practiceExerciseIndex] ? (
                        <button className="stage-primary-action" onClick={advancePhase}>
                          {practiceAllCorrect ? "看看学得怎么样" : "带薄弱点完成，先去复习"} <span>→</span>
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <p className="stage-empty-hint">本节还没有生成练习，先完成理解阶段再回来。</p>
                  )}
                </section>
              ) : null}

              {activePhase === "reflect" ? (
                <section className="learning-stage learning-stage--reflect">
                  <div className="stage-intro">
                    <span>03 · 收束本节</span>
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

                  {content.explanation?.keyPoints?.length > 0 && (
                    <FlashCardSuite
                      cards={content.explanation.keyPoints.map((point, index) => ({
                        front: `重点判断 #${index + 1}: ${point}`,
                        back: content.explanation.paragraphs[index] || content.overview,
                      }))}
                    />
                  )}

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
        <>
        <button
          className="coach-drawer-backdrop"
          aria-label="关闭随堂助教"
          onClick={() => setIsCoachOpen(false)}
        />
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
        </>
        ) : null}
      </div>
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
