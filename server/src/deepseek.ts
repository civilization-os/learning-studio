import { AiSettings } from "./types.js";

export type DeepSeekModel = {
  id: string;
  ownedBy: string;
};

export async function listDeepSeekModels(settings: AiSettings): Promise<DeepSeekModel[]> {
  if (!settings.apiKey) {
    throw new Error("请先配置 DeepSeek API Key");
  }

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/models`, {
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

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.modelName,
      messages,
      temperature: options?.temperature ?? 0.3,
      ...(options?.responseFormat
        ? { response_format: { type: options.responseFormat } }
        : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return {
    mocked: false,
    content: data?.choices?.[0]?.message?.content ?? "",
  };
}
