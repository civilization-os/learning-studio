import { AiSettings } from "./types.js";

export type DeepSeekModel = {
  id: string;
  ownedBy: string;
};

async function fetchDeepSeek(
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new Error("内容服务响应超时，请稍后重试或缩小课程范围。");
    }
    throw new Error(
      "无法连接内容服务，请检查网络和 DeepSeek 服务地址后再试。",
    );
  }
}

export async function listDeepSeekModels(settings: AiSettings): Promise<DeepSeekModel[]> {
  if (!settings.apiKey) {
    throw new Error("请先配置 DeepSeek API Key");
  }

  const response = await fetchDeepSeek(`${settings.baseUrl.replace(/\/$/, "")}/models`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
  });

  if (!response.ok) {
    const text = (await response.text()).slice(0, 400);
    throw new Error(`DeepSeek models request failed: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: unknown; owned_by?: unknown }>;
  };
  const models = (payload.data ?? [])
    .filter(
      (model) =>
        typeof model.id === "string" &&
        model.id.trim() &&
        typeof model.owned_by === "string",
    )
    .map((model) => ({
      id: String(model.id).trim(),
      ownedBy: String(model.owned_by),
    }));

  if (!models.length) {
    throw new Error("DeepSeek 官方接口未返回可用模型");
  }

  return models;
}

export async function callDeepSeek(
  settings: AiSettings,
  messages: Array<{ role: string; content: string }>,
  options?: {
    responseFormat?: "json_object";
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    maxInputCharacters?: number;
  },
) {
  if (!settings.apiKey) {
    return {
      mocked: true,
      content: "DeepSeek API Key 尚未配置。这里返回本地占位结果，配置 Key 后可切换为真实模型响应。",
    };
  }
  if (!settings.modelName.trim()) {
    throw new Error("尚未选择 DeepSeek 模型");
  }

  const maxInputCharacters = Math.max(
    4_000,
    Math.min(200_000, options?.maxInputCharacters ?? 120_000),
  );
  const inputCharacters = messages.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  if (inputCharacters > maxInputCharacters) {
    throw new Error(
      `课程上下文过长（${inputCharacters} 字符），请缩小课程范围后重试。`,
    );
  }

  const maxTokens = Math.max(
    256,
    Math.min(65_536, Math.round(options?.maxTokens ?? 4_096)),
  );
  const timeoutMs = Math.max(
    5_000,
    Math.min(300_000, Math.round(options?.timeoutMs ?? 60_000)),
  );

  const response = await fetchDeepSeek(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.modelName,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: maxTokens,
      ...(options?.responseFormat
        ? { response_format: { type: options.responseFormat } }
        : {}),
    }),
  });

  if (!response.ok) {
    const text = (await response.text()).slice(0, 1_000);
    throw new Error(`DeepSeek request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return {
    mocked: false,
    content: data?.choices?.[0]?.message?.content ?? "",
  };
}
