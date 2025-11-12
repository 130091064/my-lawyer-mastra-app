import OpenAI from "openai";

// Reuse a single OpenAI client to avoid重复初始化并保持包体积最小
export const openaiClient = new OpenAI({
  apiKey: process?.env?.OPENAI_API_KEY  || env?.OPENAI_API_KEY,
});
