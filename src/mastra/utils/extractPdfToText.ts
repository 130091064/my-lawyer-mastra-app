import { extractText } from "unpdf";

/**
 * 把 base64 的 PDF 字符串解码成 Uint8Array
 * 兼容 Node（Buffer）和 Cloudflare Workers（atob）
 */
function decodeBase64Pdf(base64: string): Uint8Array {
  // 去掉 dataURL 前缀（如果前端不小心传了）
  const pureBase64 = base64.split(",").pop() || "";

  // Node 环境
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(pureBase64, "base64"));
  }

  // Workers / 浏览器环境
  if (typeof atob !== "undefined") {
    const binary = atob(pureBase64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  throw new Error("No base64 decoder available in this environment");
}

/**
 * 用 unpdf 提取 PDF 文本
 */
export async function extractPdfTextFromBase64(
  pdfBase64: string
): Promise<string> {
  const pdfBytes = decodeBase64Pdf(pdfBase64);

  const { text } = await extractText(pdfBytes, {
    mergePages: true, // 把多页合并成一个结果，方便后续大模型处理
  });

  // text 可能是 string 或 string[]
  const content = Array.isArray(text) ? text.join("\n") : text;
  return content;
}
