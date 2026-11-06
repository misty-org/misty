import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { embedMany, generateSpeech, transcribe } from "ai";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { resolveConfiguredModel, resolveEmbeddingModel, resolveSpeechModel, resolveTranscriptionModel, type ModelRoute } from "../src/model-provider.js";
import { sdkParityCases } from "./sdk-parity.cases.js";

/**
 * Records what the Vercel AI SDK sends and parses, as fixtures the Rust crate's parity tests
 * replay (`src-tauri/crates/agent/tests/sdk_parity.rs`). It runs against a local mock with a
 * throwaway key and never reaches a provider. Run it after upgrading the SDK or adding a case:
 *
 *   MISTY_RECORD_SDK_PARITY=1 npx vitest run test/sdk-parity.record.test.ts
 */
const recording = process.env.MISTY_RECORD_SDK_PARITY === "1";

/** The fields of a multipart form, with the random boundary gone. Audio stays intact in base64. */
function multipartFields(raw: Buffer, boundary: string): unknown {
  const fields: unknown[] = [];
  const marker = Buffer.from(`--${boundary}`);
  let at = raw.indexOf(marker);
  while (at >= 0) {
    const start = at + marker.length;
    if (raw.subarray(start, start + 2).toString() === "--") break;
    const headEnd = raw.indexOf("\r\n\r\n", start);
    const end = raw.indexOf(Buffer.from(`\r\n--${boundary}`), headEnd);
    const head = raw.subarray(start, headEnd).toString();
    fields.push({
      name: /[; ]name="([^"]*)"/.exec(head)?.[1] ?? null,
      filename: /filename="([^"]*)"/.exec(head)?.[1] ?? null,
      contentType: /content-type:\s*(\S+)/i.exec(head)?.[1] ?? null,
      base64: raw.subarray(headEnd + 4, end).toString("base64"),
    });
    at = end + 2;
  }
  return { multipart: fields };
}

function parsedBody(raw: Buffer, contentType: string | undefined): unknown {
  if (!raw.length) return null;
  const boundary = /boundary=(.+)$/.exec(contentType ?? "")?.[1];
  if (boundary) return multipartFields(raw, boundary);
  return JSON.parse(raw.toString("utf8"));
}
const fixtures = resolve(import.meta.dirname, "../../../crates/agent/tests/fixtures/sdk");

interface Captured {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** The headers a client chooses. Node's transport and the SDK's version stamp aren't part of the contract. */
function chosenHeaders(request: IncomingMessage): Record<string, string> {
  const ignored = new Set(["host", "connection", "content-length", "accept-encoding", "accept-language", "sec-fetch-mode", "user-agent"]);
  return Object.fromEntries(
    Object.entries(request.headers)
      .filter(([name]) => !ignored.has(name))
      .map(([name, value]): [string, string] => [name, name === "content-type" ? String(value).replace(/; boundary=.*$/, "") : String(value)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** Where a call went and what came back with it hold this run's port and the time, which change every run. */
function withoutTransport(part: unknown): unknown {
  const failure = part as { type?: string; error?: Record<string, unknown> };
  if (failure.type !== "error" || failure.error?.name !== "AI_APICallError") return part;
  const { url: _url, requestBodyValues: _body, responseHeaders: _headers, ...error } = { ...failure.error };
  return { ...failure, error };
}

describe.runIf(recording)("SDK parity fixtures", () => {
  let server: Server;
  let base = "";
  let captured: Captured[] = [];
  let replies: Array<{ status: number; contentType: string; body?: string; bodyBase64?: string }> = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const raw = Buffer.concat(chunks);
        const reply = replies[Math.min(captured.length, replies.length - 1)]!;
        captured.push({
          method: request.method ?? "",
          path: request.url ?? "",
          headers: chosenHeaders(request),
          body: parsedBody(raw, request.headers["content-type"]),
        });
        response.writeHead(reply.status, { "content-type": reply.contentType });
        response.end(reply.bodyBase64 !== undefined ? Buffer.from(reply.bodyBase64, "base64") : (reply.body ?? ""));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    base = `${origin}/v1`;
    // Some clients have a fixed address (ChatGPT, ElevenLabs). They come here too, and nothing may
    // reach a real provider.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === origin) return realFetch(input, init);
      if (!["api.openai.com", "api.elevenlabs.io"].includes(url.hostname)) throw new Error(`Refused to call ${url.hostname} while recording.`);
      return realFetch(`${origin}${url.pathname}${url.search}`, init);
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    return new Promise((done) => server.close(done));
  });

  for (const item of sdkParityCases) {
    it(item.name, async () => {
      captured = [];
      replies = item.replies ?? [{ status: item.status ?? 200, contentType: item.contentType ?? "text/event-stream", body: item.response }];
      const route: ModelRoute = {
        provider: "device",
        reasoning: item.reasoning,
        credential: { provider: item.provider, apiKey: "test-key-parity", baseURL: base },
      };
      const file = join(fixtures, item.fixtureProvider ?? item.provider, `${item.name}.json`);
      mkdirSync(dirname(file), { recursive: true });
      if (item.kind) {
        const failureOf = (error: unknown) => {
          const failure = error as { name?: string; message?: string; statusCode?: number; isRetryable?: boolean };
          return { name: failure.name, message: failure.message, statusCode: failure.statusCode, isRetryable: failure.isRetryable };
        };
        const input = (item.input ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        let result: unknown;
        let thrown: unknown;
        try {
          if (item.kind === "embed") {
            const done = await embedMany({ model: await resolveEmbeddingModel(item.modelId, route), values: input.values, providerOptions: input.providerOptions, maxRetries: 0 });
            result = { embeddings: done.embeddings, tokens: Number.isNaN(done.usage.tokens) ? null : done.usage.tokens, warnings: done.warnings, providerMetadata: done.providerMetadata ?? null };
          } else if (item.kind === "speech") {
            const done = await generateSpeech({ model: await resolveSpeechModel(item.modelId, route), ...(input as object), maxRetries: 0 } as never);
            result = { audioBase64: Buffer.from((done as { audio: { uint8Array: Uint8Array } }).audio.uint8Array).toString("base64"), mediaType: (done as { audio: { mediaType: string } }).audio.mediaType, format: (done as { audio: { format: string } }).audio.format, warnings: (done as { warnings: unknown }).warnings, providerMetadata: (done as { providerMetadata: unknown }).providerMetadata };
          } else {
            const audio = Buffer.from(String(input.audioBase64), "base64");
            const done = await transcribe({ model: await resolveTranscriptionModel(item.modelId, route), audio, providerOptions: input.providerOptions, maxRetries: 0 });
            result = { text: done.text, segments: done.segments, language: done.language ?? null, durationInSeconds: done.durationInSeconds ?? null, warnings: done.warnings, providerMetadata: done.providerMetadata };
          }
        } catch (error) {
          thrown = failureOf(error);
        }
        writeFileSync(file, `${JSON.stringify({ name: item.name, kind: item.kind, modelId: item.modelId, credentialProvider: item.provider, input: item.input, replies, unorderedRequests: item.unorderedRequests ?? false, sent: captured, result, thrown }, null, 2)}\n`);
        return;
      }
      const { model, options } = await resolveConfiguredModel(item.modelId, item.options as unknown as LanguageModelV4CallOptions, route);
      const parts: unknown[] = [];
      let thrown: unknown;
      try {
        const { stream } = await model.doStream(options);
        for await (const part of stream as unknown as AsyncIterable<unknown>) parts.push(part);
      } catch (error) {
        const failure = error as { name?: string; message?: string; statusCode?: number; isRetryable?: boolean };
        thrown = { name: failure.name, message: failure.message, statusCode: failure.statusCode, isRetryable: failure.isRetryable };
      }
      writeFileSync(
        file,
        `${JSON.stringify(
          {
            name: item.name,
            modelId: item.modelId,
            credentialProvider: item.provider,
            reasoning: item.reasoning,
            options: item.options,
            status: item.status ?? 200,
            contentType: item.contentType ?? "text/event-stream",
            response: item.response,
            sent: captured,
            parts: JSON.parse(JSON.stringify(parts.map(withoutTransport), (_key, value) => (value instanceof Date ? value.toISOString() : value))),
            thrown,
          },
          null,
          2,
        )}\n`,
      );
    });
  }
});
