import OpenAI from "openai";
import { getEnv } from "./env";

// 每次用的时候现取 key，兼容 Node + Worker
export function getOpenAIClient() {
  const apiKey = getEnv("OPENAI_API_KEY");
  return new OpenAI({ apiKey });
}
