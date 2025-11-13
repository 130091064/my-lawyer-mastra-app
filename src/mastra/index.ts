import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { z } from "zod";
import { summonsAgent } from "./agents/summons-agent";
import { summonsWorkflow } from "./workflows/summons-workflow";
import { summonsAssistWorkflow } from "./workflows/summons-assist-workflow";
import { CloudflareDeployer } from "@mastra/deployer-cloudflare";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const applyCorsHeaders = (c: any) => {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    c.header(key, value);
  });
};

const summonsAssistRequestSchema = z.object({
  pdfBase64: z.string(),
  question: z.string().optional(),
  stayDurationHours: z.number().min(0.5).max(6).optional(),
  includeWeather: z.boolean().optional(),
  includeTransport: z.boolean().optional(),
  includePoi: z.boolean().optional(),
});

export const mastra = new Mastra({
  workflows: { summonsWorkflow, summonsAssistWorkflow },
  agents: { summonsAgent },
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    // 开启默认导出器与云端导出器，用于 AI 调用链追踪
    default: { enabled: true },
  },
  server: {
    bodySizeLimit: 10 * 1024 * 1024,
    apiRoutes: [
      {
        method: "OPTIONS",
        path: "/api/summons/assist",
        handler: async (c) => {
          applyCorsHeaders(c);
          return c.text("", 204);
        },
      },
      {
        method: "POST",
        path: "/api/summons/assist",
        handler: async (c) => {
          try {
            applyCorsHeaders(c);
            // ⭐ 关键：把 Cloudflare Worker 的 env 注入到 globalThis.__ENV__
            if ((c as any).env) {
              (globalThis as any).__ENV__ = {
                ...(globalThis as any).__ENV__,
                ...(c as any).env,
              };
            }
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

            let pdfBuffer: string;
            try {
              pdfBuffer = pdfBase64;
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
  deployer: new CloudflareDeployer({
    projectName: "my-lawyer-mastra-app",
    routes: [
      {
        pattern: "bot.deepseafish.work/*",
        zone_name: "deepseafish.work",
        custom_domain: true,
      },
    ],
    workerNamespace: "my-namespace",
    env: {
      NODE_ENV: "production",
      API_KEY: "<api-key>",
      // OPENAI_API_KEY: "<openai-api-key>",
    },
  }),
});
