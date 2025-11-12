// src/mastra/tools/summons-tool.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import OpenAI from "openai";
import { Buffer } from "buffer";

const openai = new OpenAI({
  apiKey: process?.env?.OPENAI_API_KEY  || env?.OPENAI_API_KEY
});

export const extractSummonsFromPdf = async (pdfBuffer: Buffer) => {
  const parsed = await new PDFParse({ data: pdfBuffer });
  const result = await parsed.getText();
  const text = result.text;

  const prompt = `
你是一名熟悉中国诉讼文书的法律助理。现在给你一份“开庭传票”的完整文字内容，请你从中提取以下字段，并以 JSON 格式返回（字段名必须是英文）：

- caseNumber: 案号
- cause: 案由
- hearingTime: 开庭时间（尽量保留原文中的完整时间表述）
- court: 法院名称
- courtAddress: 法院/开庭地址
- summonedPerson: 被传唤人姓名（如果有多个，以字符串形式合并）

要求：
1. 如果某个字段在文中找不到，值为 null。
2. 只返回一个 JSON 对象，不要有解释性文字。
3. 注意中国法院文书中的常见写法，如“案号：（2024）苏01民初1234号”等。

传票全文如下（原样）：



${text}
`;

  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    input: prompt,
  });

  const jsonText = (response.output_text ?? "").trim();
  const normalizedJsonText = jsonText
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  let parsedJson: any;
  try {
    parsedJson = JSON.parse(normalizedJsonText);
  } catch (error) {
    throw new Error("解析模型返回的 JSON 失败: " + normalizedJsonText);
  }

  return {
    caseNumber: parsedJson.caseNumber ?? null,
    cause: parsedJson.cause ?? null,
    hearingTime: parsedJson.hearingTime ?? null,
    court: parsedJson.court ?? null,
    courtAddress: parsedJson.courtAddress ?? null,
    summonedPerson: parsedJson.summonedPerson ?? null,
    rawText: text,
  };
};

export const summonsExtractTool = createTool({
  id: "summons-extract",
  description:
    "从中国法院的开庭传票 PDF 中提取案号、案由、开庭时间、法院、开庭地址、被传唤人等信息",

  // 工具输入：传票 PDF 的二进制内容
  inputSchema: z.object({
    pdfBuffer: z
      .instanceof(Buffer)
      .describe("开庭传票 PDF 文件内容（Node.js Buffer）"),
  }),

  // 工具输出：结构化信息
  outputSchema: z.object({
    caseNumber: z.string().nullable(), // 案号
    cause: z.string().nullable(), // 案由
    hearingTime: z.string().nullable(), // 开庭时间（保留原文格式）
    court: z.string().nullable(), // 法院名称
    courtAddress: z.string().nullable(), // 开庭地址/法院地址
    summonedPerson: z.string().nullable(), // 被传唤人
    rawText: z.string(), // 解析出来的原始全文，方便调试
  }),

  // 真正执行逻辑
  execute: async ({ inputData }) => extractSummonsFromPdf(inputData.pdfBuffer),
});
