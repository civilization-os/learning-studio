import { MathText } from "../../components/shared/MathText";
import type {
  ChapterToolLibrary,
  ChapterToolPlacement,
  LearningProject,
} from "../../studyAgent";

const chapterToolPlacementLabels: Record<ChapterToolPlacement, string> = {
  "chapter-core": "这一章会掌握",
  "chapter-support": "学习时可以查",
  "later-bridge": "后面会用到",
};

function getSourceHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "参考资料";
  }
}


export function ChapterToolLibraryDrawer({
  chapterTitle,
  currentSectionId,
  isLoading,
  isOpen,
  library,
  projectSources,
  onClose,
  onRefresh,
}: {
  chapterTitle: string;
  currentSectionId?: string;
  isLoading: boolean;
  isOpen: boolean;
  library?: ChapterToolLibrary;
  projectSources: LearningProject["sources"];
  onClose: () => void;
  onRefresh?: () => void;
}) {
  const sourceByUrl = new Map(
    (projectSources ?? []).map((source) => [source.url, source]),
  );
  const currentItems =
    library?.items.filter(
      (item) =>
        currentSectionId &&
        (item.introducedInSectionId === currentSectionId ||
          item.relatedSectionIds.includes(currentSectionId)),
    ) ?? [];
  const currentItemIds = new Set(currentItems.map((item) => item.id));
  const displayGroups = currentSectionId
    ? [
        { id: "current", label: "本节正在用", items: currentItems },
        {
          id: "chapter",
          label: "本章可以查",
          items:
            library?.items.filter(
              (item) =>
                item.placement !== "later-bridge" &&
                !currentItemIds.has(item.id),
            ) ?? [],
        },
        {
          id: "later",
          label: "后面会用到",
          items:
            library?.items.filter(
              (item) => item.placement === "later-bridge",
            ) ?? [],
        },
      ]
    : (
        [
          "chapter-core",
          "chapter-support",
          "later-bridge",
        ] as ChapterToolPlacement[]
      ).map((placement) => ({
        id: placement,
        label: chapterToolPlacementLabels[placement],
        items:
          library?.items.filter((item) => item.placement === placement) ?? [],
      }));

  return (
    <>
      <button
        className={`chapter-tools-backdrop ${isOpen ? "is-open" : ""}`}
        aria-label="关闭本章工具"
        tabIndex={isOpen ? 0 : -1}
        onClick={onClose}
      />
      <aside
        className={`chapter-tools-drawer ${isOpen ? "is-open" : ""}`}
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <header>
          <div>
            <small>本章工具</small>
            <span>{chapterTitle}</span>
            <h2>{library?.title ?? "正在整理…"}</h2>
          </div>
          <button className="icon-button" aria-label="关闭本章工具" onClick={onClose}>
            ×
          </button>
        </header>

        {isLoading || !library ? (
          <div className="chapter-tools-loading">
            <span aria-hidden="true" />
            <strong>正在整理本章会反复用到的内容</strong>
            <p>会检查课程位置、参考资料和后面的课堂，不需要停留在这里等待。</p>
          </div>
        ) : (
          <div className="chapter-tools-scroll">
            <p className="chapter-tools-scope">{library.scope}</p>
            {displayGroups.map((group) => {
              if (!group.items.length) return null;
              return (
                <section className="chapter-tools-group" key={group.id}>
                  <h3>{group.label}</h3>
                  <div>
                    {group.items.map((item) => (
                      <details className="chapter-tool-item" key={item.id}>
                        <summary>
                          <span>{item.title}</span>
                          <small>{item.summary}</small>
                          <i aria-hidden="true">＋</i>
                        </summary>
                        <div>
                          <ul>
                            {item.content.map((content, index) => (
                              <li key={`${item.id}-content-${index}`}>
                                <MathText value={content} />
                              </li>
                            ))}
                          </ul>
                          <dl>
                            <div>
                              <dt>什么时候用</dt>
                              <dd><MathText value={item.useWhen} /></dd>
                            </div>
                            <div>
                              <dt>注意什么</dt>
                              <dd><MathText value={item.boundary} /></dd>
                            </div>
                          </dl>
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              );
            })}

            {library.sourceRefs.length ? (
              <details className="chapter-tools-sources">
                <summary>整理时参考了什么</summary>
                <div>
                  {library.sourceRefs.flatMap((url) => {
                    const source = sourceByUrl.get(url);
                    return source
                      ? [
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            key={source.url}
                          >
                            <span>{source.title}</span>
                            <small>{getSourceHost(source.url)} ↗</small>
                          </a>,
                        ]
                      : [];
                  })}
                </div>
              </details>
            ) : null}
            <footer>
              <span>
                {library.generation.webSearchUsed
                  ? "已结合外部资料整理"
                  : "按课程内容整理"}
              </span>
              {onRefresh ? (
                <button type="button" onClick={onRefresh}>
                  重新整理
                </button>
              ) : null}
            </footer>
          </div>
        )}
      </aside>
    </>
  );
}

