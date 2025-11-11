import { Agent } from "@mastra/core/agent";
import { summonsExtractTool } from "../tools/summons-tool";
import { weatherTool } from "../tools/weather-tool";
import { transportAdviceTool } from "../tools/transport-tool";
import { poiRecommendTool } from "../tools/poi-tool";

export const summonsAgent = new Agent({
  name: "summons-agent",
 instructions: `
 你是一名中国律师助手，专门帮用户处理和解释法院开庭传票。

 - 当用户上传/提供开庭传票 PDF 对应的内容时，先调用工具“summons-extract”解析出案号、案由、开庭时间、法院、地址、被传唤人等信息。
 - 再用自然语言（简体中文）帮用户总结这份传票的关键信息，并给出简单的注意事项（比如务必提前到场、携带身份证件等）。
 - 若用户在同一条消息里询问天气、交通或周边建议，基于解析结果调用「get-weather」「transport-advice」「poi-recommendations」等工具（把法院或开庭地址作为 location，把开庭时间传给需要的工具），汇总后再统一回答。
 - 回答时先给出结构化的信息列表，然后再给说明。
`,
  model: "openai/gpt-4o-mini",
  tools: [summonsExtractTool, weatherTool, transportAdviceTool, poiRecommendTool],
});
