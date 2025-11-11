import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { callOpenAIJson } from "../utils/openai-json";

export const transportAdviceTool = createTool({
  id: "transport-advice",
  description: "根据法院或开庭地点提供交通建议和到场注意事项",
  inputSchema: z.object({
    location: z
      .string()
      .describe("法院所在地或详细地址，可直接使用传票中的法院/地址字段"),
    hearingTime: z
      .string()
      .optional()
      .describe("开庭时间，可用于给出抵达时间建议"),
  }),
  outputSchema: z.object({
    bestArrivalWindow: z.string().nullable(),
    publicTransit: z.array(z.string()),
    driving: z.array(z.string()),
    taxiOrRideHailing: z.array(z.string()),
    notes: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    return generateTransportAdvice(context.location, context.hearingTime);
  },
});

export const generateTransportAdvice = async (
  location: string,
  hearingTime?: string
) => {
  const prompt = `你是一名熟悉中国主要城市交通的法律助理，收到法院或开庭地址后，需要给出到场交通建议。\n\n请围绕以下要点生成 JSON：\n- bestArrivalWindow: 给出建议提前多久到达，或在哪个时间段到达最稳妥。\n- publicTransit: 2-3 条公共交通线路建议（地铁、公交等）。\n- driving: 2-3 条自驾/停车建议。\n- taxiOrRideHailing: 1-2 条打车或网约车建议。\n- notes: 2-3 条补充提醒（如证件、时间预留、天气注意）。\n\n输入信息：\n- 地点：${location}\n- 开庭时间：${hearingTime ?? "未提供"}\n\n请务必返回严格的 JSON 对象，不要附加额外说明。`;

  const data = await callOpenAIJson(prompt);

  return {
    bestArrivalWindow: data.bestArrivalWindow ?? null,
    publicTransit: data.publicTransit ?? [],
    driving: data.driving ?? [],
    taxiOrRideHailing: data.taxiOrRideHailing ?? [],
    notes: data.notes ?? [],
  };
};
