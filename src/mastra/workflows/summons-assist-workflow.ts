import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { summonsExtractTool, extractSummonsFromPdf } from "../tools/summons-tool";
import { transportAdviceTool } from "../tools/transport-tool";
import { poiRecommendTool } from "../tools/poi-tool";
import { generateContextAdvice } from "../tools/context-tool";

const workflowInputSchema = z.object({
  pdfBuffer: z.string(),
  userQuestion: z.string().optional(),
  stayDurationHours: z.number().min(0.5).max(6).optional(),
  includeTransport: z.boolean().optional(),
  includePoi: z.boolean().optional(),
});

const enrichedOutputSchema = z.object({
  structured: summonsExtractTool.outputSchema,
  userQuestion: z.string().optional(),
  transport: transportAdviceTool.outputSchema.nullable(),
  poi: poiRecommendTool.outputSchema.nullable(),
});

const extractSummonsStep = createStep({
  id: "summons-assist:extract",
  description: "解析传票 PDF 内容",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    structured: summonsExtractTool.outputSchema,
    userQuestion: z.string().optional(),
    stayDurationHours: z.number().optional(),
    includeTransport: z.boolean().optional(),
    includePoi: z.boolean().optional(),
  }),
  execute: async ({ inputData }) => {
    if (!inputData?.pdfBuffer) {
      throw new Error("缺少 PDF Buffer");
    }
    const structured = await extractSummonsFromPdf(inputData.pdfBuffer);
    return {
      structured,
      userQuestion: inputData.userQuestion,
      stayDurationHours: inputData.stayDurationHours,
      includeTransport: inputData.includeTransport,
      includePoi: inputData.includePoi,
    };
  },
});

const deriveLocationFromSummons = (
  structured: z.infer<typeof summonsExtractTool.outputSchema>
) => {
  const normalize = (value?: string | null) => value?.trim() ?? '';
  const court = normalize(structured.court);
  if (court) return court;

  const courtAddress = normalize(structured.courtAddress);
  if (courtAddress) {
    const cityMatch = courtAddress.match(/([\u4e00-\u9fa5A-Za-z]+?(?:市|州|区|县))/);
    if (cityMatch?.[1]) {
      return cityMatch[1];
    }
    const section = courtAddress.split(/[，,。\s]/).filter(Boolean)[0];
    if (section) return section;
    return courtAddress;
  }

  return normalize(structured.summonedPerson);
};

const gatherContextStep = createStep({
  id: "summons-assist:gather",
  description: "根据用户问题选择性查询交通/景点",
  inputSchema: extractSummonsStep.outputSchema,
  outputSchema: enrichedOutputSchema,
  execute: async ({ inputData }) => {
    const { structured, userQuestion } = inputData;
    const normalizedQuestion = (userQuestion ?? "").toLowerCase();

    const location = deriveLocationFromSummons(structured);

    const shouldTransport =
      typeof inputData.includeTransport === "boolean"
        ? inputData.includeTransport
        : /交通|到达|route|line/.test(normalizedQuestion);
    const shouldPoi =
      typeof inputData.includePoi === "boolean"
        ? inputData.includePoi
        : /景点|周边|poi|吃|玩/.test(normalizedQuestion);

    let transportResult:
      | z.infer<typeof transportAdviceTool.outputSchema>
      | null = null;
    let poiResult: z.infer<typeof poiRecommendTool.outputSchema> | null = null;

    if ((shouldTransport || shouldPoi) && location) {
      const stayDuration = inputData.stayDurationHours ?? 2;
      try {
        const combined = await generateContextAdvice({
          location,
          hearingTime: structured.hearingTime ?? undefined,
          stayDurationHours: stayDuration,
          includeTransport: shouldTransport,
          includePoi: shouldPoi,
        });
        transportResult = combined.transport;
        poiResult = combined.poi;
      } catch (error) {
        transportResult = shouldTransport ? null : transportResult;
        poiResult = shouldPoi ? null : poiResult;
      }
    }

    return {
      structured,
      userQuestion,
      transport: transportResult,
      poi: poiResult,
    };
  },
});

const composeAnswerStep = createStep({
  id: "summons-assist:compose",
  description: "整合所有信息生成说明",
  inputSchema: enrichedOutputSchema,
  outputSchema: enrichedOutputSchema.extend({
    narrative: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { structured, userQuestion, transport, poi } = inputData;
    const lines: string[] = [];

    lines.push("以下是传票关键信息：");
    lines.push(`- 案号：${structured.caseNumber ?? "未提供"}`);
    lines.push(`- 案由：${structured.cause ?? "未提供"}`);
    lines.push(`- 开庭时间：${structured.hearingTime ?? "未提供"}`);
    lines.push(`- 法院：${structured.court ?? "未提供"}`);
    lines.push(`- 开庭地址：${structured.courtAddress ?? "未提供"}`);
    lines.push(`- 被传唤人：${structured.summonedPerson ?? "未提供"}`);

    if (transport) {
      if (transport.bestArrivalWindow) {
        lines.push(`\n抵达时间建议：${transport.bestArrivalWindow}`);
      }
      if (transport.publicTransit.length) {
        lines.push(
          `公共交通：${transport.publicTransit
            .map((item) => `• ${item}`)
            .join("；")}`
        );
      }
      if (transport.driving.length) {
        lines.push(
          `自驾/停车：${transport.driving
            .map((item) => `• ${item}`)
            .join("；")}`
        );
      }
      if (transport.taxiOrRideHailing.length) {
        lines.push(
          `打车/网约车：${transport.taxiOrRideHailing
            .map((item) => `• ${item}`)
            .join("；")}`
        );
      }
      if (transport.notes.length) {
        lines.push(
          `交通注意事项：${transport.notes
            .map((item) => `• ${item}`)
            .join("；")}`
        );
      }
    }

    if (poi && poi.recommendations.length) {
      lines.push("\n附近可短暂停留的地点：");
      lines.push(
        ...poi.recommendations.map(
          (rec) =>
            `- ${rec.name}（${rec.type}，${rec.distance}）：亮点 ${rec.highlights}；小贴士：${rec.tips}`
        )
      );
    }
    if (poi && poi.generalAdvice.length) {
      lines.push(
        `补充建议：${poi.generalAdvice
          .map((item) => `• ${item}`)
          .join("；")}`
      );
    }

    if (userQuestion) {
      lines.push(`\n针对你的问题「${userQuestion}」，以上信息已全部覆盖。`);
    }

    return {
      structured,
      userQuestion,
      transport,
      poi,
      narrative: lines.join("\n"),
    };
  },
});

export const summonsAssistWorkflow = createWorkflow({
  id: "summons-assist-workflow",
  description: "上传传票 PDF + 问题 → 解析并输出交通与景点建议",
  inputSchema: workflowInputSchema,
  outputSchema: composeAnswerStep.outputSchema,
})
  .then(extractSummonsStep)
  .then(gatherContextStep)
  .then(composeAnswerStep)
;

summonsAssistWorkflow.commit();
