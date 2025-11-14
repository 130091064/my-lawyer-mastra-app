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

// ✅ 单独创建一个 logger，并传给 Mastra，同时自己也用它
const logger = new PinoLogger({
  name: 'Mastra',
  level: 'info',
});

export const mastra = new Mastra({
  workflows: { summonsWorkflow, summonsAssistWorkflow },
  agents: { summonsAgent },
  logger,
  // observability: {
  //   default: { enabled: true },
  // },
  server: {
    bodySizeLimit: 10 * 1024 * 1024,
    beforeHandle: [
      async (c, next) => {
        const origin = c.req.header('Origin') || '*';
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
        c.header('Access-Control-Allow-Origin', '*');

        // 入口日志
        logger.info('[beforeHandle]', {
          method: c.req.method,
          path: c.req.path,
          origin,
        });

        if (c.req.method === 'OPTIONS') {
          return c.text('', 204);
        }

        try {
          const res = await next();
          return res;
        } catch (error) {
          const normalized = normalizeErrorForResponse(error, 'UNHANDLED_ERROR');
          logger.error('[beforeHandle] error',{
            error: normalized.message,
          });
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
        method: 'POST',
        path: '/api/summons/assist',
        handler: async (c) => {
          logger.info('summonsAssistWorkflow request start');

          // Cloudflare Worker 会把环境变量挂到 c.env
          if ((c as any).env) {
            (globalThis as any).__ENV__ = {
              ...(globalThis as any).__ENV__,
              ...(c as any).env,
            };
          }

          try {
            const body = await c.req.json();
            logger.info('summonsAssistWorkflow body parsed');

            const parsed = summonsAssistRequestSchema.safeParse(body);
            if (!parsed.success) {
              logger.warn('summonsAssistWorkflow invalid body');
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
              logger.warn('summonsAssistWorkflow invalid pdf base64');
              return c.json(
                {
                  error: 'INVALID_PDF_BASE64',
                  message: 'PDF 内容解析失败',
                },
                400
              );
            }

            const workflow = mastra.getWorkflow('summonsAssistWorkflow') as any;
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
              logger.error('summonsAssistWorkflow failed', {
                error: normalized.message,
              });
              return c.json(
                {
                  error: normalized.code,
                  message: normalized.message,
                  details: normalized.details,
                },
                normalized.status
              );
            }

            logger.info('summonsAssistWorkflow success', {
              runId: (run as any).id ?? undefined,
            });

            return c.json({ status: 'ok', data: result.result });
          } catch (error) {
            const normalized = normalizeErrorForResponse(error, 'UNHANDLED_EXCEPTION');
            logger.error('summonsAssistWorkflow crashed', {
              error: normalized.message,
            });
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
