import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { callOpenAIJson } from "../utils/openai-json";

export const poiRecommendTool = createTool({
  id: "poi-recommendations",
  description: "在法院/开庭地点周边推荐可短暂停留的景点或服务设施",
  inputSchema: z.object({
    location: z
      .string()
      .describe("法院或开庭地点所在的城市/区县/详细地址"),
    stayDurationHours: z
      .number()
      .min(0.5)
      .max(6)
      .default(2)
      .describe("预计可利用的空档时间，小时"),
  }),
  outputSchema: z.object({
    recommendations: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        distance: z.string(),
        highlights: z.string(),
        tips: z.string(),
      })
    ),
    generalAdvice: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    return getPoiRecommendations(context.location, context.stayDurationHours ?? 2);
  },
});

export const getPoiRecommendations = async (
  location: string,
  stayDurationHours: number
) => {
  const prompt = `你是一名本地向导，需根据法院地点提供周边可短暂停留的景点、美食或服务设施推荐，适合当事人在等候或办事间隙使用。\n请输出 JSON，字段如下：\n- recommendations: 一个数组，元素包含 name、type（景点/美食/咖啡等）、distance（距离和交通方式）、highlights、tips。限 3 条以内。\n- generalAdvice: 2-3 条总体建议（如排队时间、携带物品、注意安全等）。\n\n地点：${location}\n可利用时间：约 ${stayDurationHours} 小时。`;

  const data = await callOpenAIJson(prompt);

  return {
    recommendations: data.recommendations ?? [],
    generalAdvice: data.generalAdvice ?? [],
  };
};
