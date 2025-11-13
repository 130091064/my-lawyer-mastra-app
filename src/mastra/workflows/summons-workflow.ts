import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { summonsExtractTool, extractSummonsFromPdf } from "../tools/summons-tool";
import { summonsAgent } from "../agents/summons-agent";

// 第一步：调用工具解析 PDF
const extractStep = createStep({
  id: "extract-summons",
  description: "解析开庭传票 PDF，提取关键信息",
  inputSchema: z.object({
    pdfBuffer: z.string(),
  }),
  outputSchema: summonsExtractTool.outputSchema, // 复用工具的输出 schema
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error("缺少传票文件内容");
    }
    return extractSummonsFromPdf(inputData.pdfBuffer);
  },
});

// 第二步：让 agent 根据解析结果给出说明（这里用简单提示词调用）
const explainStep = createStep({
  id: "explain-summons",
  description: "根据传票信息生成说明",
  inputSchema: extractStep.outputSchema,
  outputSchema: z.object({
    structured: extractStep.outputSchema,
    explanation: z.string(),
  }),
  execute: async ({ inputData }) => {
    const {
      caseNumber,
      cause,
      hearingTime,
      court,
      courtAddress,
      summonedPerson,
    } = inputData;

    const userPrompt = `
以下是从一份开庭传票中解析出的字段，请用简体中文帮我做两件事：
1. 以列表形式重复这些字段（如果是 null 就说明“未在传票中找到”）。
2. 给一个 3～5 条的注意事项/建议，提醒当事人如何准备本次开庭。

解析结果：
- 案号: ${caseNumber ?? "未找到"}
- 案由: ${cause ?? "未找到"}
- 开庭时间: ${hearingTime ?? "未找到"}
- 法院: ${court ?? "未找到"}
- 开庭地址: ${courtAddress ?? "未找到"}
- 被传唤人: ${summonedPerson ?? "未找到"}
`;

    const res = await summonsAgent.generate([
      { role: "user", content: userPrompt },
    ]);

    return {
      structured: inputData,
      explanation: (res as any).outputText ?? "",
    };
  },
});

// 整体 workflow：先解析，再说明
export const summonsWorkflow = createWorkflow({
  id: "summons-workflow",
  description: "上传开庭传票 PDF → 解析 → 生成说明",
  inputSchema: z.object({
    pdfBuffer: z.string()
  }),
  outputSchema: explainStep.outputSchema,
})
  .then(extractStep)
  .then(explainStep)
  .commit();
