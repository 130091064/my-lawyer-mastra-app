import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { z } from 'zod';
import { summonsAgent } from './agents/summons-agent';
import { summonsWorkflow } from './workflows/summons-workflow';
import { summonsAssistWorkflow } from './workflows/summons-assist-workflow';
import { CloudflareDeployer } from '@mastra/deployer-cloudflare';

type HttpFriendlyError = {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown> | null;
};

const safeSerializeDetails = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  try {
    const serialized = JSON.stringify(value, (_, innerValue) =>
      typeof innerValue === 'bigint' ? innerValue.toString() : innerValue
    );
    return JSON.parse(serialized);
  } catch {
    if (value instanceof Error) {
      return {
        message: value.message,
        stack: value.stack,
      };
    }
    return {
      summary: typeof value?.toString === 'function' ? value.toString() : Object.prototype.toString.call(value),
    };
  }
};

const normalizeErrorForResponse = (error: unknown, fallbackCode: string): HttpFriendlyError => {
  if (error instanceof Error) {
    const status = typeof (error as any).status === 'number' ? (error as any).status : 500;
    const code = typeof (error as any).code === 'string' ? (error as any).code : fallbackCode;
    return {
      status,
      code,
      message: error.message,
      details: error.stack ? { stack: error.stack } : null,
    };
  }

  if (error && typeof error === 'object') {
    const status = typeof (error as any).status === 'number' ? (error as any).status : 500;
    const code = typeof (error as any).code === 'string' ? (error as any).code : fallbackCode;
    const message = typeof (error as any).message === 'string' ? (error as any).message : JSON.stringify(error);
    return {
      status,
      code,
      message,
      details: safeSerializeDetails(error),
    };
  }

  return {
    status: 500,
    code: fallbackCode,
    message: typeof error === 'string' ? error : 'Unknown error',
    details: null,
  };
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
    name: 'Mastra',
    level: 'info',
  }),
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    default: { enabled: true },
  },
  server: {
    bodySizeLimit: 10 * 1024 * 1024,
    beforeHandle: [
      async (c, next) => {
        const origin = c.req.header('Origin') || '*';
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
        c.header('Access-Control-Allow-Origin', '*'); // 或者你之前的 *

        // 预检请求直接在这里返回
        if (c.req.method === 'OPTIONS') {
          return c.text('', 204);
        }

        try {
          const res = await next();
          return res;
        } catch (error) {
          const normalized = normalizeErrorForResponse(error, 'UNHANDLED_ERROR');
          return c.json(
            {
              error: normalized.code,
              message: normalized.message,
              details: normalized.details,
            },
            normalized.status
          );
        }
      },
    ],
    apiRoutes: [
      {
        method: 'OPTIONS',
        path: '/api/summons/assist',
        handler: async (c) => {
          return c.text('', 204);
        },
      },
      {
        method: 'POST',
        path: '/api/summons/assist',
        handler: async (c) => {
          // Cloudflare Worker 会把环境变量挂到 c.env
          if ((c as any).env) {
            (globalThis as any).__ENV__ = {
              ...(globalThis as any).__ENV__,
              ...(c as any).env,
            };
          }

          try {
            const body = await c.req.json();
            const parsed = summonsAssistRequestSchema.safeParse(body);
            if (!parsed.success) {
              return c.json(
                {
                  error: 'INVALID_BODY',
                  message: '请求参数不合法',
                  details: parsed.error.flatten(),
                },
                400
              );
            }

            const { pdfBase64, question, stayDurationHours, includeWeather, includeTransport, includePoi } =
              parsed.data;

            let pdfBuffer: string;
            try {
              pdfBuffer = pdfBase64;
            } catch {
              return c.json(
                {
                  error: 'INVALID_PDF_BASE64',
                  message: 'PDF 内容解析失败',
                },
                400
              );
            }

            const mastraInstance = c.get('mastra');
            const workflow = mastraInstance.getWorkflow('summonsAssistWorkflow');
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

            if (result.status !== 'success') {
              const workflowError = (result as any).error;
              const normalized = normalizeErrorForResponse(workflowError, 'WORKFLOW_FAILED');
              mastraInstance.logger.error(
                {
                  msg: 'summonsAssistWorkflow failed',
                  error: normalized,
                },
                normalized.message
              );
              return c.json(
                {
                  error: normalized.code,
                  message: normalized.message,
                  details: normalized.details,
                },
                normalized.status
              );
            }

            return c.json({ status: 'ok', data: result.result });
          } catch (error) {
            const mastraInstance = c.get('mastra');
            const normalized = normalizeErrorForResponse(error, 'UNHANDLED_EXCEPTION');
            mastraInstance.logger.error(
              {
                msg: 'summonsAssistWorkflow crashed',
                error: normalized,
              },
              normalized.message
            );
            return c.json(
              {
                error: normalized.code,
                message: normalized.message,
                details: normalized.details,
              },
              normalized.status
            );
          }
        },
      },
    ],
  },
  deployer: new CloudflareDeployer({
    projectName: 'my-lawyer-mastra-app',
    routes: [
      {
        pattern: 'bot.deepseafish.work/*',
        zone_name: 'deepseafish.work',
        custom_domain: true,
      },
    ],
    workerNamespace: 'my-namespace',
    env: {
      NODE_ENV: 'production',
      API_KEY: '<api-key>',
      OPENAI_API_KEY: '<openai-api-key>',
    },
  }),
});
