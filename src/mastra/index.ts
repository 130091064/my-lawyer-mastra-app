
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import { summonsAgent } from "./agents/summons-agent";
import { summonsWorkflow } from "./workflows/summons-workflow";

export const mastra = new Mastra({
  workflows: { weatherWorkflow, summonsWorkflow },
  agents: { weatherAgent, summonsAgent },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  storage: new LibSQLStore({
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    // 将可观测性、评分等数据写入内存；若需持久化请改为 file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  telemetry: {
    // Telemetry is deprecated and will be removed in the Nov 4th release
    // 遥测功能即将弃用并会在 11 月 4 日的版本中移除
    enabled: false, 
  },
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    // 开启默认导出器与云端导出器，用于 AI 调用链追踪
    default: { enabled: true }, 
  },
});
