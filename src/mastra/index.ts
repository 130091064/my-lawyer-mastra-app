import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { Buffer } from "buffer";
import { weatherWorkflow } from "./workflows/weather-workflow";
import { weatherAgent } from "./agents/weather-agent";
import {
  toolCallAppropriatenessScorer,
  completenessScorer,
  translationScorer,
} from "./scorers/weather-scorer";
import { summonsAgent } from "./agents/summons-agent";
import { summonsWorkflow } from "./workflows/summons-workflow";
import { summonsAssistWorkflow } from "./workflows/summons-assist-workflow";

const summonsAssistRequestSchema = z.object({
  pdfBase64: z.string(),
  question: z.string().optional(),
  stayDurationHours: z.number().min(0.5).max(6).optional(),
  includeWeather: z.boolean().optional(),
  includeTransport: z.boolean().optional(),
  includePoi: z.boolean().optional(),
});

export const mastra = new Mastra({
  workflows: { weatherWorkflow, summonsWorkflow, summonsAssistWorkflow },
  agents: { weatherAgent, summonsAgent },
  scorers: {
    toolCallAppropriatenessScorer,
    completenessScorer,
    translationScorer,
  },
  storage: new LibSQLStore({
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    // 将可观测性、评分等数据写入内存；若需持久化请改为 file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
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
  server: {
    bodySizeLimit: 10 * 1024 * 1024,
    apiRoutes: [
      {
        method: "POST",
        path: "/api/summons/assist",
        handler: async (c) => {
          try {
            const body = await c.req.json();
            const parsed = summonsAssistRequestSchema.safeParse(body);
            if (!parsed.success) {
              return c.json(
                { error: "INVALID_BODY", details: parsed.error.flatten() },
                400
              );
            }

            const {
              pdfBase64,
              question,
              stayDurationHours,
              includeWeather,
              includeTransport,
              includePoi,
            } = parsed.data;

            let pdfBuffer: Buffer;
            try {
              pdfBuffer = Buffer.from(pdfBase64, "base64");
            } catch (err) {
              return c.json({ error: "INVALID_PDF_BASE64" }, 400);
            }

            const mastraInstance = c.get("mastra");
            // 通过 { serialized: false } 取得真实 workflow 实例，才能调用 start
            const workflow = mastraInstance.getWorkflow(
              "summonsAssistWorkflow"
            );

            // 2. 创建一次运行实例
            const run = await (workflow as any).createRunAsync();

            const result = await run.start({
              inputData: {
                pdfBuffer,
                userQuestion: question,
                stayDurationHours,
                includeWeather,
                includeTransport,
                includePoi,
              },
            });

            if (result.status !== "success") {
              const workflowError = (result as any).error;
              const message =
                workflowError?.message ??
                (workflowError
                  ? JSON.stringify(workflowError)
                  : "Unknown error");

              mastraInstance.logger.error("summonsAssistWorkflow failed");
              return c.json(
                {
                  error: "WORKFLOW_FAILED",
                  message,
                  details: workflowError ?? null,
                },
                500
              );
            }

            return c.json({ status: "ok", data: result.result });
          } catch (error) {
            const mastraInstance = c.get("mastra");
            const message =
              error instanceof Error ? error.message : "Unhandled exception";
            mastraInstance.logger.error("summonsAssistWorkflow crashed");
            return c.json(
              {
                error: "UNHANDLED_EXCEPTION",
                message,
                details: error instanceof Error ? { stack: error.stack } : null,
              },
              500
            );
          }
        },
      },
    ],
  },
});
