export function getEnv(key: string): string {
  // 1. Node 环境（mastra dev、本地脚本）
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key] as string;
  }

  // 2. Cloudflare Worker 环境：我们会把 c.env 写到 globalThis.__ENV__ 上
  if (typeof globalThis !== "undefined" && (globalThis as any).__ENV__?.[key]) {
    return (globalThis as any).__ENV__[key] as string;
  }

  throw new Error(`环境变量 ${key} 未设置`);
}
