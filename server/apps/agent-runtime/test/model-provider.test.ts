import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { InstanceModel } from "../src/instance-model.js";
import {
  instanceModelConfig,
  resolveInstanceModel,
  resolveProviderModel,
} from "../src/model-provider.js";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { WorkflowAgent } from "@ai-sdk/workflow";
import { isStepCount, tool } from "ai";
import { z } from "zod";

const options: LanguageModelV4CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  providerOptions: { gateway: { models: ["other/provider"] } },
  reasoning: "high",
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("model routing", () => {
  it.each(["low", "max"])(
    "uses account OpenAI credentials and %s reasoning over instance defaults",
    async (reasoning) => {
      const accountFetch = vi.fn<typeof fetch>(
        async () =>
          new Response('{"error":{"message":"fixture rejection"}}', {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      );
      const globalFetch = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", globalFetch);
      const resolved = resolveProviderModel(
        "openai/gpt-6-luna",
        options,
        {
          provider: "openai",
          model: "openai/gpt-6-luna",
          apiKey: "account-fixture",
          baseURL: "https://account.example/v1",
          reasoning,
        },
        { AI_GATEWAY_API_KEY: "unused-gateway-fixture" },
        accountFetch,
      );
      await expect(resolved.model.doGenerate(resolved.options)).rejects.toThrow();
      expect(globalFetch).not.toHaveBeenCalled();
      expect(accountFetch).toHaveBeenCalledTimes(1);
      const [url, request] = accountFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://account.example/v1/responses");
      expect(new Headers(request.headers).get("authorization")).toBe("Bearer account-fixture");
      const body = JSON.parse(request.body as string);
      expect(body.model).toBe("gpt-6-luna");
      expect(body.reasoning.effort).toBe(reasoning);
      expect(resolved.options.providerOptions).not.toHaveProperty("gateway");
    },
  );

  it("keeps optional browser arguments optional on the Responses wire", async () => {
    const fetch = rejectingFetch();
    const toolOptions: LanguageModelV4CallOptions = {
      ...options,
      tools: [
        {
          type: "function",
          name: "browser_inspect",
          inputSchema: {
            type: "object",
            properties: {
              scopeId: { type: "string" },
              extensionId: { type: "integer", minimum: 1 },
            },
            required: ["scopeId"],
            additionalProperties: false,
          },
        },
        {
          type: "function",
          name: "explicit_strict",
          strict: true,
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ],
    };
    const resolved = resolveProviderModel(
      "openai/gpt-6-luna",
      toolOptions,
      account("openai", "openai/gpt-6-luna"),
      {},
      fetch,
    );
    await expect(resolved.model.doGenerate(resolved.options)).rejects.toThrow();
    const [, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(request.body as string);
    expect(body.tools[0].strict).toBe(false);
    expect(body.tools[0].parameters.required).toEqual(["scopeId"]);
    expect(body.tools[1].strict).toBe(true);
    expect(toolOptions.tools?.[0]).not.toHaveProperty("strict");
  });

  it("streams tool execution and its readback through account OpenAI Responses", async () => {
    let count = 0;
    const fetch = vi.fn(async () => {
      const first = count++ === 0;
      const item = first
        ? {
            type: "function_call",
            id: "fc-1",
            call_id: "read-1",
            name: "read_note",
            arguments: "{}",
            status: "completed",
          }
        : {
            type: "message",
            id: "msg-1",
            role: "assistant",
            content: [{ type: "output_text", text: "The note says hello.", annotations: [] }],
          };
      const chunks = [
        {
          type: "response.created",
          response: { id: `resp-${count}`, created_at: 1, model: "gpt-6-luna" },
        },
        { type: "response.output_item.added", output_index: 0, item },
        ...(!first
          ? [
              {
                type: "response.output_text.delta",
                item_id: "msg-1",
                output_index: 0,
                delta: "The note says hello.",
              },
            ]
          : []),
        { type: "response.output_item.done", output_index: 0, item },
        {
          type: "response.completed",
          response: {
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 1 },
            },
          },
        },
      ];
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const read = vi.fn(async () => ({ text: "hello" }));
    const agent = new WorkflowAgent({
      model: resolveProviderModel(
        "openai/gpt-6-luna",
        options,
        account("openai", "openai/gpt-6-luna"),
        {},
        fetch as unknown as typeof globalThis.fetch,
      ).model,
      reasoning: "low",
      maxRetries: 0,
      stopWhen: isStepCount(2),
      tools: { read_note: tool({ inputSchema: z.object({}), execute: read }) },
    });
    const result = await agent.stream({
      prompt: "Read the note",
      providerOptions: options.providerOptions,
    });
    expect(read).toHaveBeenCalledOnce();
    expect(result.steps.at(-1)?.text).toBe("The note says hello.");
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls) {
      const [url, request] = call as unknown as [string, RequestInit];
      expect(url).toBe("https://account.example/v1/responses");
      expect(new Headers(request.headers).get("authorization")).toBe("Bearer account-fixture");
      const body = JSON.parse(request.body as string);
      expect(body.reasoning.effort).toBe("low");
      expect(body.model).toBe("gpt-6-luna");
      expect(body).not.toHaveProperty("gateway");
    }
    const [, request] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(request.body as string).input).toContainEqual({
      type: "function_call_output",
      call_id: "read-1",
      output: '{"text":"hello"}',
    });
  });

  it("routes instance models through the AI Gateway", () => {
    const result = resolveInstanceModel("openai/example", options, {
      AI_GATEWAY_API_KEY: "fixture",
    });
    expect(result.model.provider).toBe("gateway");
    expect(result.options).toBe(options);
  });

  it.each(["openai", "anthropic", "google", "openai-compatible"])(
    "routes an account %s connection directly without gateway fallback",
    (provider) => {
      const result = resolveProviderModel(
        `${provider}/example`,
        options,
        account(provider, `${provider}/example`),
        {},
        rejectingFetch(),
      );
      expect(result.model.modelId).toBe("example");
      expect(result.model.provider).not.toBe("gateway");
      expect(result.options.providerOptions).not.toHaveProperty("gateway");
    },
  );

  it("rejects invalid instance models and unconfigured account models", () => {
    for (const model of ["example", "openai/", "openai/has space"])
      expect(() => instanceModelConfig({ MISTY_AGENT_MODEL: model })).toThrow();
    expect(instanceModelConfig({})).toEqual({ provider: "gateway", model: "" });
    expect(() =>
      resolveProviderModel(
        "anthropic/wrong",
        options,
        account("anthropic", "anthropic/example"),
        {},
        rejectingFetch(),
      ),
    ).toThrow("not configured");
  });

  it("keeps credentials out of durable model state", () => {
    const serialized = InstanceModel[WORKFLOW_SERIALIZE](new InstanceModel("openai/example"));
    expect(serialized).toEqual({ modelId: "openai/example", identity: undefined, role: "agent" });
    expect(InstanceModel[WORKFLOW_DESERIALIZE](serialized).modelId).toBe("openai/example");
  });

  it.each([
    ["openai", "/responses", "authorization", "Bearer account-fixture"],
    ["anthropic", "/messages", "x-api-key", "account-fixture"],
    ["google", "/models/example:generateContent", "x-goog-api-key", "account-fixture"],
  ])(
    "sends account %s credentials only to its configured provider endpoint",
    async (provider, path, header, expected) => {
      const fetch = rejectingFetch();
      const globalFetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", globalFetch);
      const result = resolveProviderModel(
        `${provider}/example`,
        options,
        account(provider, `${provider}/example`),
        {},
        fetch,
      );
      await expect(result.model.doGenerate(result.options)).rejects.toThrow();
      const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`https://account.example/v1${path}`);
      expect(new Headers(request.headers).get(header!)).toBe(expected);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(globalFetch).not.toHaveBeenCalled();
    },
  );

  it("streams a tool call and final answer through the real WorkflowAgent adapter", async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      const delta =
        calls++ === 0
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: "read-1",
                  type: "function",
                  function: { name: "read_note", arguments: "{}" },
                },
              ],
            }
          : { content: "The note says hello." };
      const chunks = [
        {
          id: "result",
          created: 1,
          model: "local",
          choices: [{ index: 0, delta, finish_reason: null }],
        },
        {
          id: "result",
          created: 1,
          model: "local",
          choices: [{ index: 0, delta: {}, finish_reason: calls === 1 ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ];
      return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    });
    const read = vi.fn(async () => ({ text: "hello" }));
    const agent = new WorkflowAgent({
      model: resolveProviderModel(
        "openai-compatible/local",
        options,
        {
          provider: "openai-compatible",
          model: "openai-compatible/local",
          baseURL: "http://localhost:1234/v1",
        },
        {},
        fetch as unknown as typeof globalThis.fetch,
      ).model,
      stopWhen: isStepCount(2),
      tools: { read_note: tool({ inputSchema: z.object({}), execute: read }) },
    });
    const result = await agent.stream({
      prompt: "Read the note",
      providerOptions: options.providerOptions,
    });
    expect(read).toHaveBeenCalledOnce();
    expect(result.steps.at(-1)?.text).toBe("The note says hello.");
    expect(result.steps.at(-1)?.usage.totalTokens).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls) {
      const [, request] = call as unknown as [string, RequestInit];
      expect(new Headers(request.headers).has("authorization")).toBe(false);
      expect(JSON.parse(request.body as string)).not.toHaveProperty("gateway");
    }
  });
});

function account(provider: string, model: string) {
  return { provider, model, apiKey: "account-fixture", baseURL: "https://account.example/v1" };
}

function rejectingFetch() {
  return vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response('{"error":{"message":"fixture rejection"}}', {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
  );
}
