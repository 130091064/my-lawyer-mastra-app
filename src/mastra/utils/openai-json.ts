import { getOpenAIClient } from "./openai-client";

// 帮助函数：请求 OpenAI Responses API 并解析 JSON 输出
export const callOpenAIJson = async (
  prompt: string,
  model = "gpt-4o-mini"
): Promise<any> => {
  const openaiClient = getOpenAIClient();

  const response = await openaiClient.responses.create({
    model,
    input: prompt,
  } as any);

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
