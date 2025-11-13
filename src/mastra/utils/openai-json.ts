import { getOpenAIClient } from "./openai-client";

type OpenAIError = Error & {
  status?: number;
  code?: string;
  error?: { message?: string };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTimeoutError = (error: OpenAIError) => {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.status === 408 ||
    error?.status === 504 ||
    error?.code === "ETIMEDOUT" ||
    message.includes("timeout")
  );
};

const formatOpenAIError = (error: OpenAIError) => {
  const status = error?.status;
  if (status === 429) {
    return "OpenAI 请求过于频繁或额度不足，请稍后重试或提升配额。";
  }
  if (isTimeoutError(error)) {
    return "OpenAI 响应超时，请稍后重试。";
  }
  if (status && status >= 500) {
    return "OpenAI 服务暂时不可用，请稍后再试。";
  }
  return error?.error?.message || error?.message || "调用 OpenAI 接口失败";
};

// 帮助函数：请求 OpenAI Responses API 并解析 JSON 输出
export const callOpenAIJson = async (
  prompt: string,
  model = "gpt-4o-mini"
): Promise<any> => {
  const openaiClient = getOpenAIClient();

  const maxRetries = 1;
  let attempt = 0;
  let response;
  while (attempt <= maxRetries) {
    try {
      response = await openaiClient.responses.create({
        model,
        input: prompt,
      } as any);
      break;
    } catch (error) {
      const typed = error as OpenAIError;
      if (attempt < maxRetries && isTimeoutError(typed)) {
        await sleep(500 * (attempt + 1));
        attempt += 1;
        continue;
      }
      throw new Error(formatOpenAIError(typed));
    }
  }

  const rawText = (response.output_text ?? "").trim();
  const normalizedText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(normalizedText);
  } catch (error) {
    throw new Error(`解析模型 JSON 失败: ${normalizedText}`);
  }
};
