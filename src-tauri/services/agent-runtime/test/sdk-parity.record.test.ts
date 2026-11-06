import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { afterAll, beforeAll, describe, it } from "vitest";
import { resolveConfiguredModel, type ModelRoute } from "../src/model-provider.js";
import { sdkParityCases } from "./sdk-parity.cases.js";

/**
 * Records what the Vercel AI SDK sends and parses, as fixtures the Rust crate's parity tests
 * replay (`src-tauri/crates/agent/tests/sdk_parity.rs`). It runs against a local mock with a
 * throwaway key and never reaches a provider. Run it after upgrading the SDK or adding a case:
 *
 *   MISTY_RECORD_SDK_PARITY=1 npx vitest run test/sdk-parity.record.test.ts
 */
const recording = process.env.MISTY_RECORD_SDK_PARITY === "1";
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
      .map(([name, value]): [string, string] => [name, String(value)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

describe.runIf(recording)("SDK parity fixtures", () => {
  let server: Server;
  let base = "";
  let captured: Captured[] = [];
  let reply: { status: number; contentType: string; body: string } = { status: 200, contentType: "text/event-stream", body: "" };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        captured.push({
          method: request.method ?? "",
          path: request.url ?? "",
          headers: chosenHeaders(request),
          body: raw ? JSON.parse(raw) : null,
        });
        response.writeHead(reply.status, { "content-type": reply.contentType });
        response.end(reply.body);
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => new Promise((done) => server.close(done)));

  for (const item of sdkParityCases) {
    it(item.name, async () => {
      captured = [];
      reply = { status: item.status ?? 200, contentType: item.contentType ?? "text/event-stream", body: item.response };
      const route: ModelRoute = {
        provider: "device",
        reasoning: item.reasoning,
        credential: { provider: item.provider, apiKey: "test-key-parity", baseURL: base },
      };
      const { model, options } = await resolveConfiguredModel(item.modelId, item.options as unknown as LanguageModelV4CallOptions, route);
      const parts: unknown[] = [];
      let thrown: unknown;
      try {
        const { stream } = await model.doStream(options);
        for await (const part of stream as unknown as AsyncIterable<unknown>) parts.push(part);
      } catch (error) {
        const failure = error as { name?: string; statusCode?: number; isRetryable?: boolean };
        thrown = { name: failure.name, statusCode: failure.statusCode, isRetryable: failure.isRetryable };
      }
      const file = join(fixtures, item.fixtureProvider ?? item.provider, `${item.name}.json`);
      mkdirSync(dirname(file), { recursive: true });
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
            parts: JSON.parse(JSON.stringify(parts, (_key, value) => (value instanceof Date ? value.toISOString() : value))),
            thrown,
          },
          null,
          2,
        )}\n`,
      );
    });
  }
});
