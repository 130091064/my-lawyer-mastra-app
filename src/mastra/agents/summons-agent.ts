import { Agent } from "@mastra/core/agent";
import { summonsExtractTool } from "../tools/summons-tool";

export const summonsAgent = new Agent({
  name: "summons-agent",
  instructions: `
你是一名中国律师助手，专门帮用户处理和解释法院开庭传票。

- 当用户上传/提供开庭传票 PDF 对应的内容时，先调用工具“summons-extract”解析出案号、案由、开庭时间、法院、地址、被传唤人等信息。
- 再用自然语言（简体中文）帮用户总结这份传票的关键信息，并给出简单的注意事项（比如务必提前到场、携带身份证件等）。
- 回答时先给出结构化的信息列表，然后再给说明。
`,
  model: "openai/gpt-4o-mini",
  tools: [summonsExtractTool],
});
