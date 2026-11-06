import type { ProviderId } from "../src/model-provider.js";

/**
 * Model calls the Vercel AI SDK and the Rust crate must treat the same. Each runs through
 * `sdk-parity.record.test.ts`. Responses are written by hand in each provider's wire format.
 */
export interface SdkParityCase {
  name: string;
  provider: ProviderId;
  /** Groups a provider's fixtures when several share one client. */
  fixtureProvider?: string;
  modelId: string;
  reasoning?: string;
  options: Record<string, unknown>;
  response: string;
  status?: number;
  contentType?: string;
}

const sse = (...events: unknown[]) => `${events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("")}`;

const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1_790_000_000,
  model: "test-model",
  choices: [{ index: 0, delta, finish_reason: null }],
  ...extra,
});

const done = (reason: string, usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 }) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1_790_000_000,
  model: "test-model",
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
  usage,
});

const userAsks = (text: string) => ({ role: "user", content: [{ type: "text", text }] });

const weatherTool = {
  type: "function",
  name: "weather_forecast",
  description: "The forecast for a place.",
  inputSchema: {
    type: "object",
    properties: { place: { type: "string" }, days: { type: "number" } },
    required: ["place"],
    additionalProperties: false,
  },
};

const compatibleCases: SdkParityCase[] = [
  {
    name: "text",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: {
      prompt: [{ role: "system", content: "Be brief." }, userAsks("Say hello.")],
      maxOutputTokens: 200,
      temperature: 0.2,
    },
    response: sse(chunk({ role: "assistant", content: "" }), chunk({ content: "Hel" }), chunk({ content: "lo." }), done("stop"), "[DONE]"),
  },
  {
    name: "reasoning_text",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    reasoning: "high",
    options: { prompt: [userAsks("Think, then answer.")] },
    response: sse(
      chunk({ role: "assistant", reasoning_content: "Let " }),
      chunk({ reasoning_content: "me think." }),
      chunk({ content: "Done." }),
      done("stop", { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14, completion_tokens_details: { reasoning_tokens: 4 }, prompt_tokens_details: { cached_tokens: 2 } } as never),
      "[DONE]",
    ),
  },
  {
    name: "tool_call_streamed",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: {
      prompt: [userAsks("Weather in Oslo?")],
      tools: [weatherTool],
      toolChoice: { type: "auto" },
    },
    response: sse(
      chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "weather_forecast", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: "{\"place\":" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: "\"Oslo\"}" } }] }),
      done("tool_calls"),
      "[DONE]",
    ),
  },
  {
    name: "parallel_tool_calls_with_text",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: { prompt: [userAsks("Two places.")], tools: [weatherTool], toolChoice: { type: "required" } },
    response: sse(
      chunk({ role: "assistant", content: "Checking both." }),
      chunk({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "weather_forecast", arguments: "{\"place\":\"Oslo\"}" } }] }),
      chunk({ tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "weather_forecast", arguments: "{\"place\":\"Rome\"}" } }] }),
      done("tool_calls"),
      "[DONE]",
    ),
  },
  {
    name: "tool_result_turn",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: {
      prompt: [
        { role: "system", content: "Be brief." },
        userAsks("Weather in Oslo?"),
        {
          role: "assistant",
          content: [
            { type: "text", text: "Checking." },
            { type: "tool-call", toolCallId: "call_1", toolName: "weather_forecast", input: { place: "Oslo" } },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call_1", toolName: "weather_forecast", output: { type: "text", value: "Rain" } }],
        },
      ],
      tools: [weatherTool],
    },
    response: sse(chunk({ role: "assistant", content: "It rains." }), done("stop"), "[DONE]"),
  },
  {
    name: "tool_result_json_and_error_outputs",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: {
      prompt: [
        userAsks("Go."),
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "a", toolName: "one", input: {} },
            { type: "tool-call", toolCallId: "b", toolName: "two", input: {} },
            { type: "tool-call", toolCallId: "c", toolName: "three", input: {} },
          ],
        },
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "a", toolName: "one", output: { type: "json", value: { ok: true } } },
            { type: "tool-result", toolCallId: "b", toolName: "two", output: { type: "error-text", value: "It broke" } },
            { type: "tool-result", toolCallId: "c", toolName: "three", output: { type: "error-json", value: { code: 1 } } },
          ],
        },
      ],
    },
    response: sse(chunk({ role: "assistant", content: "Ok." }), done("stop"), "[DONE]"),
  },
  {
    name: "screenshot_moves_out_of_tool_result",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: {
      prompt: [
        userAsks("Look."),
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "shot", toolName: "screen_look", input: {} }] },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "shot",
              toolName: "screen_look",
              output: {
                type: "content",
                value: [
                  { type: "text", text: "The page." },
                  { type: "file", data: { type: "data", data: "aGVsbG8=" }, mediaType: "image/png" },
                ],
              },
            },
          ],
        },
      ],
    },
    response: sse(chunk({ role: "assistant", content: "Seen." }), done("stop"), "[DONE]"),
  },
  {
    name: "user_image",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: {
      prompt: [{ role: "user", content: [{ type: "text", text: "What is this?" }, { type: "file", data: { type: "data", data: "aGVsbG8=" }, mediaType: "image/jpeg" }] }],
    },
    response: sse(chunk({ role: "assistant", content: "A cat." }), done("stop"), "[DONE]"),
  },
  {
    name: "structured_output",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: {
      prompt: [userAsks("List it.")],
      responseFormat: { type: "json", name: "answer", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false } },
    },
    response: sse(chunk({ role: "assistant", content: "{\"a\":\"b\"}" }), done("stop"), "[DONE]"),
  },
  {
    name: "length_finish_and_no_done_marker",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: { prompt: [userAsks("Long.")], maxOutputTokens: 2 },
    response: sse(chunk({ role: "assistant", content: "Cut" }), done("length")),
  },
  {
    name: "malformed_chunk_mid_stream",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: { prompt: [userAsks("Go.")] },
    response: sse(chunk({ role: "assistant", content: "Fine" }), "{not json", done("stop"), "[DONE]"),
  },
  {
    name: "provider_error_chunk",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: { prompt: [userAsks("Go.")] },
    response: sse({ error: { message: "Overloaded", type: "server_error" } }),
  },
  {
    name: "rate_limited",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: { prompt: [userAsks("Go.")] },
    status: 429,
    contentType: "application/json",
    response: JSON.stringify({ error: { message: "Slow down", type: "rate_limit" } }),
  },
  {
    name: "server_error",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: { prompt: [userAsks("Go.")] },
    status: 503,
    contentType: "application/json",
    response: JSON.stringify({ error: { message: "Down", type: "server_error" } }),
  },
  {
    name: "bad_request",
    provider: "nvidia",
    modelId: "nvidia/test-model",
    options: { prompt: [userAsks("Go.")] },
    status: 400,
    contentType: "application/json",
    response: JSON.stringify({ error: { message: "Bad", type: "invalid_request_error" } }),
  },
  {
    name: "openrouter_keeps_reasoning",
    provider: "openrouter",
    modelId: "openrouter/some/model",
    reasoning: "low",
    options: { prompt: [userAsks("Hi.")] },
    response: sse(chunk({ role: "assistant", content: "Hi." }), done("stop"), "[DONE]"),
  },
  {
    name: "ollama_without_key_shape",
    provider: "ollama",
    modelId: "ollama/llama3",
    options: { prompt: [userAsks("Hi.")] },
    response: sse(chunk({ role: "assistant", content: "Hi." }), done("stop"), "[DONE]"),
  },
];

export const sdkParityCases: SdkParityCase[] = [...compatibleCases].map((item) => ({ ...item, fixtureProvider: item.fixtureProvider ?? "openai-compatible" }));
