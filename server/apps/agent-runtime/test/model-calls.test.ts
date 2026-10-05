import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const accountFetch = vi.fn<typeof fetch>();
vi.mock("../src/provider-fetch.js", () => ({ providerFetch: () => accountFetch }));

const { embedCall, generateTextCall, modelCallFailure, transcribeCall } = await import("../src/model-calls.js");

const account = {
  provider: "openai" as const,
  model: "openai/gpt-6-luna",
  apiKey: "account-fixture",
  baseURL: "https://account.example/v1",
  reasoning: "low",
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => accountFetch.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("model calls", () => {
  it("returns a structured object and usage through the account's own provider", async () => {
    const globalFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", globalFetch);
    accountFetch.mockResolvedValue(
      json({
        id: "resp-1",
        created_at: 1,
        model: "gpt-6-luna",
        output: [
          {
            type: "message",
            id: "msg-1",
            role: "assistant",
            content: [{ type: "output_text", text: '{"assets":[{"id":"a"}]}', annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens_details: { reasoning_tokens: 5 },
        },
      }),
    );
    const result = await generateTextCall({
      route: account,
      model: "openai/gpt-6-luna",
      system: "Return only JSON.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this." },
            { type: "image", mediaType: "image/png", data: Buffer.from("png").toString("base64") },
          ],
        },
      ],
      maxOutputTokens: 6400,
      schema: {
        name: "smart_library_analysis_v2",
        schema: {
          type: "object",
          properties: { assets: { type: "array", items: { type: "object" } } },
          required: ["assets"],
          additionalProperties: false,
        },
      },
    });
    expect(result.object).toEqual({ assets: [{ id: "a" }] });
    expect(result.usage).toEqual({ inputTokens: 120, cachedInputTokens: 20, outputTokens: 30, reasoningTokens: 5 });
    expect(globalFetch).not.toHaveBeenCalled();
    const [url, request] = accountFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://account.example/v1/responses");
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer account-fixture");
    const body = JSON.parse(request.body as string);
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning.effort).toBe("low");
    expect(body.max_output_tokens).toBe(6400);
    expect(body.text.format.type).toBe("json_schema");
    expect(JSON.stringify(body.input)).toContain("input_image");
  });

  it("refuses a model the connection was not configured for", async () => {
    await expect(
      generateTextCall({
        route: account,
        model: "openai/another-model",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        maxOutputTokens: 10,
      }),
    ).rejects.toThrow("not configured");
    expect(accountFetch).not.toHaveBeenCalled();
  });

  it("embeds with the requested dimensions and reports tokens", async () => {
    accountFetch.mockResolvedValue(
      json({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }], usage: { prompt_tokens: 9 } }),
    );
    const result = await embedCall({
      route: { ...account, model: "openai/text-embedding-3-small" },
      model: "openai/text-embedding-3-small",
      values: ["first", "second"],
      dimensions: 768,
    });
    expect(result).toEqual({ embeddings: [[0.1, 0.2], [0.3, 0.4]], usage: { inputTokens: 9 } });
    const [url, request] = accountFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://account.example/v1/embeddings");
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({ model: "text-embedding-3-small", input: ["first", "second"], dimensions: 768 });
  });

  it("keeps visual embeddings on Misty's own Gateway", async () => {
    await expect(
      embedCall({
        route: { ...account, model: "openai/text-embedding-3-small" },
        model: "openai/text-embedding-3-small",
        values: ["query"],
        images: [{ mediaType: "image/png", data: "cG5n" }],
      }),
    ).rejects.toMatchObject({ status: 400, code: "visual_embeddings_unsupported" });
    expect(accountFetch).not.toHaveBeenCalled();
  });

  it("transcribes audio into timed segments", async () => {
    accountFetch.mockResolvedValue(
      json({
        text: "Hello there.",
        language: "english",
        duration: 2.5,
        segments: [
          {
            id: 0,
            seek: 0,
            start: 0,
            end: 2.4,
            text: "Hello there.",
            tokens: [1, 2],
            temperature: 0,
            avg_logprob: -0.2,
            compression_ratio: 1,
            no_speech_prob: 0,
          },
        ],
      }),
    );
    const result = await transcribeCall({
      route: { ...account, model: "openai/whisper-1" },
      model: "openai/whisper-1",
      mediaType: "audio/webm",
      audio: Buffer.from("audio").toString("base64"),
    });
    expect(result.text).toBe("Hello there.");
    expect(result.segments).toEqual([{ start: 0, end: 2.4, text: "Hello there." }]);
    expect(result.durationInSeconds).toBe(2.5);
    const [url] = accountFetch.mock.calls[0] as [string];
    expect(url).toBe("https://account.example/v1/audio/transcriptions");
  });

  it("rejects malformed calls before any provider request", async () => {
    for (const body of [
      {},
      { route: account, model: "no-slash", messages: [], maxOutputTokens: 1 },
      { route: account, model: "openai/x", values: [], dimensions: 768 },
      { route: { provider: "elsewhere" }, model: "openai/x", values: ["a"] },
    ]) {
      await expect(embedCall(body)).rejects.toMatchObject({ status: 400 });
    }
    expect(accountFetch).not.toHaveBeenCalled();
  });

  it("reports provider failures without their response bodies", () => {
    const failure = modelCallFailure(Object.assign(new Error("secret echoed by provider"), { statusCode: 401 }));
    expect(failure).toEqual({
      status: 502,
      body: { code: "model_call_failed", message: "The model provider could not complete the request.", upstream_status: 401 },
    });
  });
});
