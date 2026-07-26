import { WebSearchSettings, WebSource } from "./types.js";

const tavilyApiUrl = process.env.TAVILY_API_URL ?? "https://api.tavily.com/search";

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
};

type TavilyResponse = {
  results?: TavilyResult[];
};

export type WebSearchResult = {
  sources: WebSource[];
  webSearchUsed: boolean;
  warning?: string;
};

function asSource(result: TavilyResult): WebSource | null {
  if (
    typeof result.title !== "string" ||
    typeof result.url !== "string" ||
    typeof result.content !== "string"
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(result.url);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  return {
    title: result.title.trim().slice(0, 180),
    url: url.href,
    snippet: result.content.trim().slice(0, 1_200),
    ...(typeof result.score === "number" ? { score: result.score } : {}),
  };
}

export async function searchWeb(
  settings: WebSearchSettings,
  query: string,
): Promise<WebSearchResult> {
  if (!settings.apiKey) {
    return {
      sources: [],
      webSearchUsed: false,
      warning: "Tavily API Key 尚未配置，已使用模型知识生成大纲。",
    };
  }

  const response = await fetch(tavilyApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      topic: "general",
      max_results: 6,
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    const message = (await response.text()).slice(0, 400);
    throw new Error(`Tavily search failed: ${response.status} ${message}`);
  }

  const data = (await response.json()) as TavilyResponse;
  const sources = (data.results ?? [])
    .map(asSource)
    .filter((source): source is WebSource => Boolean(source))
    .slice(0, 6);

  return {
    sources,
    webSearchUsed: sources.length > 0,
    ...(sources.length === 0 ? { warning: "Web Search 未返回可用资料，已使用模型知识生成。" } : {}),
  };
}
