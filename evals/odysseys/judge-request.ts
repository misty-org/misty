// One judge call by plain fetch, in each provider's own format. Nothing here decides a score:
// the prompts and the parse are in judge.ts.
import { readFileSync } from "node:fs";
import type { JudgeConfig } from "./judge-config.ts";

export interface JudgeInput {
  system: string;
  text: string;
  /** Screenshot files, in order. */
  images: string[];
  /** A reply can be long; a thinking model needs room for both, or the verdict comes back empty. */
  maxOutputTokens: number;
}

export interface JudgeReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface JudgeRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

const mediaType = (file: string) => (file.endsWith(".png") ? "image/png" : "image/jpeg");
const base64 = (file: string) => readFileSync(file).toString("base64");

export function buildJudgeRequest(judge: JudgeConfig, input: JudgeInput): JudgeRequest {
  const base = judge.baseUrl.replace(/\/$/, "");
  const json = { "content-type": "application/json" };
  switch (judge.provider) {
    case "anthropic":
      return {
        url: `${base}/v1/messages`,
        headers: { ...json, "x-api-key": judge.key, "anthropic-version": "2023-06-01" },
        body: {
          model: judge.providerModel,
          max_tokens: input.maxOutputTokens,
          system: input.system,
          messages: [{ role: "user", content: [
            { type: "text", text: input.text },
            ...input.images.map((file) => ({ type: "image", source: { type: "base64", media_type: mediaType(file), data: base64(file) } })),
          ] }],
        },
      };
    case "google":
      return {
        // The key goes in a header, never in the address.
        url: `${base}/v1beta/models/${encodeURIComponent(judge.providerModel)}:generateContent`,
        headers: { ...json, "x-goog-api-key": judge.key },
        body: {
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [
            { text: input.text },
            ...input.images.map((file) => ({ inlineData: { mimeType: mediaType(file), data: base64(file) } })),
          ] }],
          generationConfig: { maxOutputTokens: input.maxOutputTokens },
        },
      };
    case "openai":
    case "openai-compatible":
      return {
        url: `${base}/chat/completions`,
        headers: { ...json, ...(judge.key ? { authorization: `Bearer ${judge.key}` } : {}) },
        body: {
          model: judge.providerModel,
          // OpenAI's own newer models refuse max_tokens; most compatible servers only know it.
          ...(judge.provider === "openai" ? { max_completion_tokens: input.maxOutputTokens } : { max_tokens: input.maxOutputTokens }),
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: [
              { type: "text", text: input.text },
              ...input.images.map((file) => ({ type: "image_url", image_url: { url: `data:${mediaType(file)};base64,${base64(file)}` } })),
            ] },
          ],
        },
      };
  }
}

interface Part {
  type?: string;
  text?: string;
  thought?: boolean;
}

export function parseJudgeReply(judge: JudgeConfig, body: unknown): JudgeReply {
  const reply = body as {
    content?: Part[];
    usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
    candidates?: Array<{ content?: { parts?: Part[] } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    choices?: Array<{ message?: { content?: string | Part[] | null } }>;
  };
  const joined = (parts: Part[] | undefined) => (parts ?? []).filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("");
  switch (judge.provider) {
    case "anthropic":
      return { text: joined(reply.content), inputTokens: reply.usage?.input_tokens ?? 0, outputTokens: reply.usage?.output_tokens ?? 0 };
    case "google":
      return { text: joined(reply.candidates?.[0]?.content?.parts), inputTokens: reply.usageMetadata?.promptTokenCount ?? 0, outputTokens: reply.usageMetadata?.candidatesTokenCount ?? 0 };
    case "openai":
    case "openai-compatible": {
      const content = reply.choices?.[0]?.message?.content;
      return { text: typeof content === "string" ? content : joined(content ?? []), inputTokens: reply.usage?.prompt_tokens ?? 0, outputTokens: reply.usage?.completion_tokens ?? 0 };
    }
  }
}

/** A failure's words, always without the key, in case a provider repeats it. */
export const withoutKey = (text: string, key: string) => (key ? text.split(key).join("[key]") : text);

export async function askJudge(judge: JudgeConfig, input: JudgeInput, timeoutMs: number): Promise<JudgeReply> {
  const request = buildJudgeRequest(judge, input);
  const quiet = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: quiet });
  } catch (error) {
    throw new Error(quiet.aborted ? "judge_quiet" : withoutKey(`judge request: fetch failed: ${String(error)}`, judge.key));
  }
  const text = await response.text().catch((error: unknown) => {
    throw new Error(quiet.aborted ? "judge_quiet" : withoutKey(`judge reply: fetch failed: ${String(error)}`, judge.key));
  });
  if (!response.ok) throw new Error(withoutKey(`judge ${response.status}: ${text.slice(0, 300)}`, judge.key));
  return parseJudgeReply(judge, JSON.parse(text));
}
