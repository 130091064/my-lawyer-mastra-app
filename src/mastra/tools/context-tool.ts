import { z } from "zod";
import { callOpenAIJson } from "../utils/openai-json";
import { transportAdviceTool } from "./transport-tool";
import { poiRecommendTool } from "./poi-tool";

export const combinedAdviceSchema = z.object({
  transport: transportAdviceTool.outputSchema.nullable(),
  poi: poiRecommendTool.outputSchema.nullable(),
});

export const generateContextAdvice = async (
  params: {
    location: string;
    hearingTime?: string;
    stayDurationHours: number;
    includeTransport: boolean;
    includePoi: boolean;
  }
) => {
  const {
    location,
    hearingTime,
    stayDurationHours,
    includeTransport,
    includePoi,
  } = params;

  if (!includeTransport && !includePoi) {
    return { transport: null, poi: null };
  }

  const prompt = `你是一名熟悉法院流程的本地向导，需要根据传票信息生成交通与周边建议。\n` +
    `始终返回 JSON 对象 { "transport": ..., "poi": ... }。\n` +
    `若某一部分被标记为不需要，则将对应字段设置为 null。\n` +
    `transport 字段结构与下列示例一致：\n` +
    `{"bestArrivalWindow":"建议提前30分钟","publicTransit":["地铁1号线..."],"driving":["自驾建议"],"taxiOrRideHailing":["打车建议"],"notes":["注意事项"]}\n` +
    `poi 字段结构示例：\n` +
    `{"recommendations":[{"name":"XX咖啡","type":"咖啡","distance":"步行10分钟","highlights":"环境安静","tips":"注意提前排队"}],"generalAdvice":["建议携带身份证"]}\n` +
    `地点：${location}\n` +
    `开庭时间：${hearingTime ?? "未提供"}\n` +
    `可利用时间：${stayDurationHours} 小时\n` +
    `需要交通建议：${includeTransport ? "是" : "否"}\n` +
    `需要周边建议：${includePoi ? "是" : "否"}`;

  const data = await callOpenAIJson(prompt);

  return combinedAdviceSchema.parse({
    transport: includeTransport ? data.transport ?? null : null,
    poi: includePoi ? data.poi ?? null : null,
  });
};
