import { useEffect, useState } from "react";
import type { TutorSceneContext } from "../../api";
import { MathText } from "../../components/shared/MathText";
import type {
  ExerciseItem,
  LessonContent,
  LessonKnowledgeState,
  LessonProgress,
  LessonScene,
  LessonSceneEvidence,
} from "../../studyAgent";

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

const REVIEW_INTERVALS = [1, 3, 7, 15, 30];

function getNextReviewDate(
  previous: LessonKnowledgeState | undefined,
  correct: boolean,
  now = new Date(),
) {
  const currentInterval = previous?.intervalDays ?? 1;
  const currentReviewCount = previous?.reviewCount ?? 0;
  let nextInterval: number;
  let nextReviewCount: number;
  if (!correct) {
    nextInterval = 1;
    nextReviewCount = 0;
  } else if (currentReviewCount >= REVIEW_INTERVALS.length - 1) {
    nextInterval = REVIEW_INTERVALS[REVIEW_INTERVALS.length - 1];
    nextReviewCount = currentReviewCount;
  } else {
    nextInterval = REVIEW_INTERVALS[currentReviewCount + 1];
    nextReviewCount = currentReviewCount + 1;
  }
  const nextReview = new Date(now);
  nextReview.setDate(nextReview.getDate() + nextInterval);
  return {
    nextReviewAt: nextReview.toISOString(),
    intervalDays: nextInterval,
    reviewCount: nextReviewCount,
  };
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
  const review = getNextReviewDate(previous, result.correct, now);
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
      nextReviewAt: review.nextReviewAt,
      intervalDays: review.intervalDays,
      reviewCount: review.reviewCount,
    } satisfies LessonKnowledgeState,
  };
}

export function LessonSceneFlow({
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
          <h3><MathText value={scene.title} /></h3>
          <p><MathText value={scene.instruction} /></p>
        </header>

        {scene.body ? (
          <div className="lesson-scene-body">
            <MathText value={scene.body} />
          </div>
        ) : null}

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
                    <span><MathText value={option} /></span>
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
                        <p><MathText value={hint} /></p>
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
                  <MathText
                    value={
                      (isCorrect
                        ? scene.feedback?.correct
                        : attempts < 2
                          ? `先不公布答案。${availableHints[Math.max(0, hintCount - 1)] ?? "重新对照题目中的判断条件，再试一次。"}`
                          : scene.feedback?.incorrect) ??
                      "重新对照题目中的判断条件，再试一次。"
                    }
                  />
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
                          <MathText
                            value={
                              scene.remediation ??
                              scene.feedback?.incorrect ??
                              "回到题干，把决定答案的条件与刚才选择的理由逐一对照。"
                            }
                          />
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
                    <p><MathText value={scene.challenge} /></p>
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
                  <p><MathText value={step} /></p>
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
              <strong><MathText value={scene.takeaway} /></strong>
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

export function PracticeCard({
  exercise,
  sectionId,
  onAskForHint,
  onResult,
  onRetry,
  onRequestVariant,
  variantLoading = false,
  isVariant = false,
}: {
  exercise: ExerciseItem;
  sectionId: string;
  onAskForHint: (level: number) => Promise<string | undefined>;
  onResult: (result: {
    correct: boolean;
    selectedIndex: number;
    resolved: boolean;
  }) => void;
  onRetry: () => void;
  onRequestVariant?: () => void;
  variantLoading?: boolean;
  isVariant?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [selfChecked, setSelfChecked] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [hintCount, setHintCount] = useState(0);
  const [hintText, setHintText] = useState("");
  const [isHintLoading, setIsHintLoading] = useState(false);

  useEffect(() => {
    setSelected(null);
    setTextAnswer("");
    setSelfChecked(null);
    setSubmitted(false);
    setAttempts(0);
    setHintCount(0);
    setHintText("");
    setIsHintLoading(false);
  }, [sectionId, exercise.question]);

  const isChoiceType = exercise.type === "single-choice" || exercise.type === "true-false";
  const options =
    exercise.type === "single-choice"
      ? exercise.options ?? []
      : exercise.type === "true-false"
        ? ["正确", "错误"]
        : [];
  const isCorrect =
    submitted &&
    (exercise.type === "single-choice"
      ? selected !== null && selected === exercise.answerIndex
      : exercise.type === "true-false"
        ? selected !== null && selected === (exercise.answer ? 0 : 1)
        : exercise.type === "fill-blank"
          ? normalizeAnswer(textAnswer, exercise.acceptedAnswers ?? [])
          : exercise.type === "calculation"
            ? normalizeAnswer(textAnswer, exercise.acceptedResult ?? [])
            : selfChecked === true);
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
    if (exercise.type === "explanation") {
      if (!textAnswer.trim()) return;
      const nextAttempts = attempts + 1;
      const resolved = selfChecked !== null || nextAttempts >= 2;
      setAttempts(nextAttempts);
      setSubmitted(true);
      onResult({
        correct: selfChecked === true,
        selectedIndex: -1,
        resolved: resolved || selfChecked !== null,
      });
      return;
    }
    if (isChoiceType) {
      if (selected === null) return;
      const nextAttempts = attempts + 1;
      const correct =
        exercise.type === "single-choice"
          ? selected === exercise.answerIndex
          : selected === (exercise.answer ? 0 : 1);
      const resolved = correct || nextAttempts >= 2;
      setAttempts(nextAttempts);
      setSubmitted(true);
      onResult({ correct, selectedIndex: selected, resolved });
      return;
    }
    if (!textAnswer.trim()) return;
    const nextAttempts = attempts + 1;
    const correct =
      exercise.type === "fill-blank"
        ? normalizeAnswer(textAnswer, exercise.acceptedAnswers ?? [])
        : exercise.type === "calculation"
          ? normalizeAnswer(textAnswer, exercise.acceptedResult ?? [])
          : false;
    const resolved = correct || nextAttempts >= 2;
    setAttempts(nextAttempts);
    setSubmitted(true);
    onResult({ correct, selectedIndex: -1, resolved });
  }

  function chooseAgain() {
    setSelected(null);
    setTextAnswer("");
    setSelfChecked(null);
    setSubmitted(false);
    onRetry();
  }

  function resetPractice() {
    setSelected(null);
    setTextAnswer("");
    setSelfChecked(null);
    setSubmitted(false);
    setAttempts(0);
    setHintCount(0);
    setHintText("");
    onRetry();
  }

  const exerciseTypeLabel: Record<ExerciseItem["type"], string> = {
    "single-choice": "单选",
    "true-false": "判断",
    "fill-blank": "填空",
    calculation: "计算",
    explanation: "简答",
  };

  return (
    <section className="practice-workbench">
      <aside className="practice-brief">
        <div>
          <small>应用任务</small>
          <h3>{isVariant ? "变式重练" : "多题练习"}</h3>
          <p>
            {isVariant
              ? "刚才那题没站稳，换一个角度再试一次。"
              : "把学到的关系用在不同的问题上。"}
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
                    : selected !== null || textAnswer.trim()
                      ? "可以提交判断"
                      : "等待你的作答"}
            </strong>
          </div>
        </div>
      </aside>

      <article className="practice-task">
        <header>
          <div>
            <small>{exercise.knowledgePoint || "本节练习"}</small>
            <span>{exerciseTypeLabel[exercise.type]}</span>
          </div>
          <h3><MathText value={exercise.question} /></h3>
        </header>

        {isChoiceType ? (
          <div className="practice-options">
            {options.map((option, optionIndex) => {
              const isSelected = selected === optionIndex;
              const isAnswer =
                shouldRevealAnswer &&
                (exercise.type === "single-choice"
                  ? optionIndex === exercise.answerIndex
                  : optionIndex === (exercise.answer ? 0 : 1));
              const isWrong =
                submitted &&
                isSelected &&
                !isAnswer;
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
                  <span><MathText value={option} /></span>
                  <em />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="practice-text-input">
            {exercise.type === "explanation" ? (
              <textarea
                value={textAnswer}
                onChange={(event) => setTextAnswer(event.target.value)}
                placeholder="写下你的解释，答完再对照要点自查。"
                disabled={submitted}
                rows={5}
              />
            ) : (
              <input
                type="text"
                value={textAnswer}
                onChange={(event) => setTextAnswer(event.target.value)}
                placeholder={
                  exercise.type === "calculation"
                    ? "输入计算结果（可含单位）"
                    : "输入你的答案"
                }
                disabled={submitted}
              />
            )}
            {submitted && exercise.type === "explanation" && selfChecked === null ? (
              <div className="practice-reference-points">
                <small>判分参考要点</small>
                <ul>
                  {(exercise.referencePoints ?? []).map((point, pointIndex) => (
                    <li key={pointIndex}><MathText value={point} /></li>
                  ))}
                </ul>
                <div className="practice-self-check">
                  <button className="scene-next-button" onClick={() => { setSelfChecked(true); onResult({ correct: true, selectedIndex: -1, resolved: true }); }}>
                    我覆盖了这些要点
                  </button>
                  <button className="soft-pill" onClick={() => { setSelfChecked(false); onResult({ correct: false, selectedIndex: -1, resolved: false }); }}>
                    还没答到点
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {hintText ? (
          <section className="practice-hint" aria-live="polite">
            <span>{String(hintCount).padStart(2, "0")}</span>
            <div>
              <small>助教提示</small>
              <p><MathText value={hintText} /></p>
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
              <MathText
                value={
                  isCorrect || attempts >= 2
                    ? exercise.explanation ?? ""
                    : "重新检查题目中的限定词，以及每个选项是否同时满足这些条件。"
                }
              />
            </p>
          </section>
        ) : null}

        <footer className="practice-actions">
          {!submitted ? (
            <>
              <button
                className="scene-next-button"
                disabled={
                  isChoiceType ? selected === null : !textAnswer.trim()
                }
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
          ) : !isResolved && exercise.type !== "explanation" ? (
            <>
              <button className="scene-next-button" onClick={chooseAgain}>
                重新作答 <span>↻</span>
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
            <>
              {!isCorrect && onRequestVariant ? (
                <button
                  className="scene-next-button"
                  disabled={variantLoading}
                  onClick={() => void onRequestVariant()}
                >
                  {variantLoading ? "正在出变式题…" : "换一道变式重练"} <span>↻</span>
                </button>
              ) : null}
              <button className="soft-pill" onClick={resetPractice}>
                重新练习
              </button>
            </>
          )}
        </footer>
      </article>
    </section>
  );
}

function normalizeAnswer(input: string, accepted: string[]) {
  const compact = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/\s+/g, "")
      .replace(/[，。、；：,.;:！？!?（）()]/g, "");
  const target = compact(input);
  if (!target) return false;
  return accepted.some((entry) => {
    const candidate = compact(entry);
    if (!candidate) return false;
    return target === candidate || target.includes(candidate) || candidate.includes(target);
  });
}
