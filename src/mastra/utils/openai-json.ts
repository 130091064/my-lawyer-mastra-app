// ✅ 1. 先放一段“Node 专用代理配置”
if (typeof process !== 'undefined' && process.release?.name === 'node') {
  // 动态引入，避免在 Cloudflare Worker 环境报错
  import('undici')
    .then(({ ProxyAgent, setGlobalDispatcher }) => {
      const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
      if (!proxy) {
        // console.log('[proxy] 未检测到 HTTP(S)_PROXY，跳过代理配置');
        return;
      }

      const agent = new ProxyAgent(proxy);
      setGlobalDispatcher(agent);
      // console.log('[proxy] 使用代理:', proxy);
    })
    .catch((err) => {
      // console.error('[proxy] 设置代理失败:', err);
    });
}

import { getOpenAIClient } from './openai-client';

type OpenAIError = Error & {
  status?: number;
  code?: string;
  error?: { message?: string };
};

type NormalizedError = {
  message: string;
  status: number;
  code: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTimeoutError = (error: OpenAIError) => {
  const message = error?.message?.toLowerCase() ?? '';
  return (
    error?.status === 408 ||
    error?.status === 504 ||
    error?.code === 'ETIMEDOUT' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('the operation was aborted')
  );
};

const normalizeOpenAIError = (error: OpenAIError): NormalizedError => {
  if (error?.status === 429) {
    return {
      status: 429,
      code: 'OPENAI_RATE_LIMIT',
      message: 'OpenAI 请求过于频繁或额度不足，请稍后重试或提升配额',
    };
  }

  if (isTimeoutError(error)) {
    return {
      status: 504,
      code: 'OPENAI_TIMEOUT',
      message: 'OpenAI 响应超时，请稍后重试',
    };
  }

  if (error?.status && error.status >= 500) {
    return {
      status: 502,
      code: 'OPENAI_UPSTREAM_ERROR',
      message: 'OpenAI 服务暂时不可用，请稍后再试',
    };
  }

  return {
    status: error?.status ?? 500,
    code: 'OPENAI_REQUEST_FAILED',
    message: error?.error?.message || error?.message || '调用 OpenAI 接口失败，请稍后再试',
  };
};

const buildError = (error: NormalizedError) => {
  const enrichedError = new Error(error.message) as Error & {
    status?: number;
    code?: string;
  };
  enrichedError.status = error.status;
  enrichedError.code = error.code;
  return enrichedError;
};

// 帮助函数：请求 OpenAI Responses API 并解析 JSON 输出
export const callOpenAIJson = async (prompt: string, model = 'gpt-4o-mini'): Promise<any> => {
  const openaiClient = getOpenAIClient();

  const maxRetries = 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await openaiClient.responses.create({
        model,
        input: prompt,
        // ✅ 新写法：在 Responses API 里用 text.format 开 JSON 模式
        text: {
          format: { type: 'json_object' },
        },
      } as any);

      const rawText = (response.output_text ?? '').trim();
      const normalizedText = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/, '')
        .trim();

      try {
        return JSON.parse(normalizedText);
      } catch {
        const parseError = new Error(`解析模型 JSON 失败: ${normalizedText}`) as Error & {
          status?: number;
          code?: string;
        };
        parseError.status = 502;
        parseError.code = 'OPENAI_INVALID_JSON';
        throw parseError;
      }
    } catch (error) {
      const typed = error as OpenAIError;
      // console.error('OpenAI error raw:', typed);
      if (attempt < maxRetries && isTimeoutError(typed)) {
        await sleep(500 * (attempt + 1));
        attempt += 1;
        continue;
      }

      throw buildError(normalizeOpenAIError(typed));
    }
  }

  throw buildError({
    status: 504,
    code: 'OPENAI_RETRIES_EXHAUSTED',
    message: '调用 OpenAI 失败：重试次数已用尽',
  });
};
