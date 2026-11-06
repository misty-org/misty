import type { ModelMessage } from "ai";
import { withCacheBreakpoint } from "../src/context/prompt-cache.js";
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
  /** A call that isn't a language model's, recorded through the `ai` package's own function. */
  kind?: "embed" | "speech" | "transcribe";
  input?: Record<string, unknown>;
  /** Answers given in order, the last one repeating, for calls that make several requests. */
  replies?: Array<{ status: number; contentType: string; body?: string; bodyBase64?: string }>;
  /** Calls made in parallel can reach the server in any order. */
  unorderedRequests?: boolean;
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

const googleChunk = (parts: unknown[], extra: Record<string, unknown> = {}, candidate: Record<string, unknown> = {}) => ({
  responseId: "resp-google-1",
  candidates: [{ content: { role: "model", parts }, index: 0, ...candidate }],
  ...extra,
});

const googleDone = (reason = "STOP", usage: Record<string, unknown> = { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 15 }, candidate: Record<string, unknown> = {}) => ({
  responseId: "resp-google-1",
  candidates: [{ content: { role: "model", parts: [] }, finishReason: reason, index: 0, ...candidate }],
  usageMetadata: usage,
});

const googleHi = sse(googleChunk([{ text: "Hi." }]), googleDone());

const assistantCalls = (...calls: Array<{ id: string; name: string; input: unknown; signature?: string }>) => ({
  role: "assistant",
  content: calls.map((call) => ({
    type: "tool-call",
    toolCallId: call.id,
    toolName: call.name,
    input: call.input,
    ...(call.signature ? { providerOptions: { google: { thoughtSignature: call.signature } } } : {}),
  })),
});

const toolResults = (...results: Array<{ id: string; name: string; output: unknown }>) => ({
  role: "tool",
  content: results.map((result) => ({ type: "tool-result", toolCallId: result.id, toolName: result.name, output: result.output })),
});

const googleCases: SdkParityCase[] = [
  {
    name: "text_with_settings",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [{ role: "system", content: "Be brief." }, { role: "system", content: "Be kind." }, userAsks("Say hello.")],
      maxOutputTokens: 200,
      temperature: 0.2,
      topP: 0.9,
      stopSequences: ["END"],
      seed: 7,
    },
    response: sse(googleChunk([{ text: "Hel" }]), googleChunk([{ text: "lo." }]), googleDone()),
  },
  {
    name: "gemini_alias_and_gateway_options_removed",
    provider: "google",
    modelId: "gemini/gemini-2.5-flash",
    options: { prompt: [userAsks("Hi.")], providerOptions: { gateway: { models: ["gateway/a"] } } },
    response: googleHi,
  },
  {
    name: "reasoning_budget_on_gemini_25",
    provider: "google",
    modelId: "google/gemini-2.5-pro",
    reasoning: "high",
    options: { prompt: [userAsks("Think.")] },
    response: sse(
      googleChunk([{ text: "Let me ", thought: true }]),
      googleChunk([{ text: "think.", thought: true }]),
      googleChunk([{ text: "Done." }]),
      googleDone("STOP", { promptTokenCount: 5, candidatesTokenCount: 2, thoughtsTokenCount: 9, totalTokenCount: 16 }),
    ),
  },
  {
    name: "reasoning_none_on_gemini_25",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    reasoning: "none",
    options: { prompt: [userAsks("Quick.")] },
    response: googleHi,
  },
  {
    name: "reasoning_level_on_gemini_3_with_signatures",
    provider: "google",
    modelId: "google/gemini-3-pro",
    reasoning: "xhigh",
    options: { prompt: [userAsks("Think.")] },
    response: sse(
      googleChunk([{ text: "Hmm.", thought: true, thoughtSignature: "sig-thought" }]),
      googleChunk([{ text: "More.", thought: true }]),
      googleChunk([{ text: "Answer", thoughtSignature: "sig-text" }]),
      googleChunk([{ text: " here." }]),
      googleChunk([{ text: "", thoughtSignature: "sig-empty" }]),
      googleDone(),
    ),
  },
  {
    name: "reasoning_minimal_on_late_flash",
    provider: "google",
    modelId: "google/gemini-3.7-flash",
    reasoning: "minimal",
    options: { prompt: [userAsks("Hi.")] },
    response: googleHi,
  },
  {
    name: "reasoning_none_on_flash_lite",
    provider: "google",
    modelId: "google/gemini-3.7-flash-lite",
    reasoning: "none",
    options: { prompt: [userAsks("Hi.")] },
    response: googleHi,
  },
  {
    name: "reasoning_unknown_warns",
    provider: "google",
    modelId: "google/gemini-3-pro",
    reasoning: "max",
    options: { prompt: [userAsks("Hi.")] },
    response: googleHi,
  },
  {
    name: "reasoning_provider_default_sends_nothing",
    provider: "google",
    modelId: "google/gemini-3-pro",
    reasoning: "provider-default",
    options: { prompt: [userAsks("Hi.")] },
    response: googleHi,
  },
  {
    name: "thinking_options_merge_over_reasoning",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    reasoning: "low",
    options: { prompt: [userAsks("Hi.")], providerOptions: { google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } } } },
    response: googleHi,
  },
  {
    name: "provider_options_reach_the_request",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [userAsks("Hi.")],
      tools: [weatherTool],
      providerOptions: {
        google: {
          threshold: "BLOCK_ONLY_HIGH",
          cachedContent: "cachedContents/abc",
          labels: { team: "misty" },
          responseModalities: ["TEXT"],
          audioTimestamp: true,
          mediaResolution: "MEDIA_RESOLUTION_LOW",
          serviceTier: "flex",
          retrievalConfig: { latLng: { latitude: 1.5, longitude: 2.5 } },
          unknownOption: "dropped",
        },
      },
    },
    response: googleHi,
  },
  {
    name: "explicit_safety_settings_win",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [userAsks("Hi.")],
      providerOptions: { google: { threshold: "OFF", safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }] } },
    },
    response: googleHi,
  },
  {
    name: "vertex_only_options_warn",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Hi.")], providerOptions: { google: { streamFunctionCallArguments: true, requestType: "shared" } } },
    response: googleHi,
  },
  {
    name: "user_files",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "What are these?" },
            { type: "file", mediaType: "image/png", data: { type: "data", data: "iVBORw0KGgo=" } },
            { type: "file", mediaType: "image/*", data: { type: "data", data: "/9j/4AAQ" } },
            { type: "file", mediaType: "image", data: { type: "data", data: "iVBORw0KGgo=" } },
            { type: "file", mediaType: "application/pdf", data: { type: "data", data: "JVBERi0=" } },
            { type: "file", mediaType: "video/mp4", data: { type: "url", url: "https://www.youtube.com/watch?v=abc" } },
          ],
        },
      ],
    },
    response: googleHi,
  },
  {
    name: "tools_and_schema_conversion",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [userAsks("Use them.")],
      tools: [
        {
          type: "function",
          name: "zeta_first",
          description: "Order matters.",
          inputSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            required: ["zulu", "alpha"],
            additionalProperties: false,
            properties: {
              zulu: { type: "string", description: "Last letter.", minLength: 2, format: "date-time" },
              alpha: { type: ["string", "null"] },
              mike: { anyOf: [{ type: "number" }, { type: "null" }] },
              bravo: { anyOf: [{ type: "number" }, { type: "string" }, { type: "null" }] },
              golf: { type: "array", items: { $ref: "#/$defs/thing" } },
              kilo: { enum: ["a", "b"] },
              lima: { type: "integer", enum: [1, 2] },
              nova: { const: "only" },
              oscar: { oneOf: [{ type: "string" }, { type: "boolean" }] },
              papa: { allOf: [{ type: "object", properties: { x: { type: "string" } } }] },
              quebec: { type: "object", description: "Anything." },
              romeo: { type: "object" },
              sierra: true,
              tango: { type: ["null"] },
              uniform: { enum: ["a", null] },
              victor: { type: "object", additionalProperties: true },
            },
            $defs: { thing: { type: "object", properties: { name: { type: "string" } } } },
          },
        },
        { type: "function", name: "no_input", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
      ],
    },
    response: googleHi,
  },
  {
    name: "tool_choice_auto",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Weather?")], tools: [weatherTool], toolChoice: { type: "auto" } },
    response: googleHi,
  },
  {
    name: "tool_choice_none",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Weather?")], tools: [weatherTool], toolChoice: { type: "none" } },
    response: googleHi,
  },
  {
    name: "tool_choice_required",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Weather?")], tools: [weatherTool], toolChoice: { type: "required" } },
    response: googleHi,
  },
  {
    name: "tool_choice_named",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Weather?")], tools: [weatherTool], toolChoice: { type: "tool", toolName: "weather_forecast" } },
    response: googleHi,
  },
  {
    name: "strict_tools_validate",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Weather?")], tools: [{ ...weatherTool, strict: true }] },
    response: googleHi,
  },
  {
    name: "strict_tools_with_auto_choice",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Weather?")], tools: [{ ...weatherTool, strict: true }], toolChoice: { type: "auto" } },
    response: googleHi,
  },
  {
    name: "function_call_with_generated_id",
    provider: "google",
    modelId: "google/gemini-3-pro",
    options: { prompt: [userAsks("Weather?")], tools: [weatherTool] },
    response: sse(
      googleChunk([{ text: "Checking." }, { functionCall: { name: "weather_forecast", args: { place: "Oslo", days: 2 } }, thoughtSignature: "sig-call" }]),
      googleDone(),
    ),
  },
  {
    name: "parallel_calls_and_argument_order",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Weather?")], tools: [weatherTool] },
    response: sse(
      googleChunk([
        { functionCall: { id: "call-one", name: "weather_forecast", args: { zulu: 1, alpha: { nested_z: true, nested_a: [2.5, "x"] } } } },
        { functionCall: { name: "weather_forecast", args: {} } },
        { functionCall: { id: "call-three", name: "no_args" } },
        { functionCall: { id: "call-four", name: "string_args", args: "{\"raw\": true}" } },
      ]),
      googleDone(),
    ),
  },
  {
    name: "calls_across_chunks_keep_finish_reason",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Weather?")], tools: [weatherTool] },
    response: sse(
      googleChunk([{ functionCall: { id: "call-one", name: "weather_forecast", args: { place: "Oslo" } } }]),
      googleChunk([{ text: "Also." }], { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 } }, { finishReason: "STOP" }),
    ),
  },
  {
    name: "tool_results_of_every_kind",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [
        userAsks("Do it."),
        assistantCalls(
          { id: "a", name: "plain", input: { z: 1, a: 2 }, signature: "sig-kept" },
          { id: "b", name: "structured", input: {} },
          { id: "c", name: "failed", input: {} },
          { id: "d", name: "failed_json", input: {} },
          { id: "e", name: "denied", input: {} },
          { id: "f", name: "denied_reason", input: {} },
        ),
        toolResults(
          { id: "a", name: "plain", output: { type: "text", value: "Fine." } },
          { id: "b", name: "structured", output: { type: "json", value: { z: 1, a: [true, null] } } },
          { id: "c", name: "failed", output: { type: "error-text", value: "Broke." } },
          { id: "d", name: "failed_json", output: { type: "error-json", value: { code: 5 } } },
          { id: "e", name: "denied", output: { type: "execution-denied" } },
          { id: "f", name: "denied_reason", output: { type: "execution-denied", reason: "Not allowed." } },
        ),
      ],
    },
    response: googleHi,
  },
  {
    name: "screenshot_in_tool_result_before_gemini_3",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [
        userAsks("Look."),
        assistantCalls({ id: "a", name: "shot", input: {} }, { id: "b", name: "doc", input: {} }),
        toolResults(
          { id: "a", name: "shot", output: { type: "content", value: [{ type: "text", text: "A page." }, { type: "file", mediaType: "image/png", data: { type: "data", data: "iVBORw0KGgo=" } }] } },
          { id: "b", name: "doc", output: { type: "content", value: [{ type: "file", mediaType: "application/pdf", data: { type: "data", data: "JVBERi0=" } }, { type: "file", data: { type: "url", url: "https://example.com/a.png" }, mediaType: "image/png" }] } },
        ),
      ],
    },
    response: googleHi,
  },
  {
    name: "screenshot_in_tool_result_on_gemini_3",
    provider: "google",
    modelId: "google/gemini-3-pro",
    options: {
      prompt: [
        userAsks("Look."),
        assistantCalls({ id: "a", name: "shot", input: {}, signature: "s1" }, { id: "b", name: "only_image", input: {} }, { id: "c", name: "by_url", input: {} }),
        toolResults(
          { id: "a", name: "shot", output: { type: "content", value: [{ type: "text", text: "One." }, { type: "text", text: "Two." }, { type: "file", mediaType: "image/*", data: { type: "data", data: "iVBORw0KGgo=" } }] } },
          { id: "b", name: "only_image", output: { type: "content", value: [{ type: "file", mediaType: "image/png", data: { type: "data", data: "iVBORw0KGgo=" } }] } },
          { id: "c", name: "by_url", output: { type: "content", value: [{ type: "file", mediaType: "image/png", data: { type: "url", url: "data:image/jpeg;base64,/9j/4AAQ" } }, { type: "file", data: { type: "url", url: "https://example.com/a.png" }, mediaType: "image/png" }] } },
        ),
      ],
    },
    response: googleHi,
  },
  {
    name: "signature_replay_and_missing_signature_on_gemini_3",
    provider: "google",
    modelId: "google/gemini-3-pro",
    options: {
      prompt: [
        userAsks("One."),
        assistantCalls({ id: "a", name: "unsigned", input: {} }, { id: "b", name: "signed", input: {}, signature: "s2" }, { id: "c", name: "after_signed", input: {} }, { id: "d", name: "unsigned", input: {} }),
        toolResults(
          { id: "a", name: "unsigned", output: { type: "text", value: "ok" } },
          { id: "b", name: "signed", output: { type: "text", value: "ok" } },
          { id: "c", name: "after_signed", output: { type: "text", value: "ok" } },
          { id: "d", name: "unsigned", output: { type: "text", value: "ok" } },
        ),
      ],
    },
    response: googleHi,
  },
  {
    name: "assistant_text_and_reasoning_replayed",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [
        userAsks("One."),
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Thinking.", providerOptions: { google: { thoughtSignature: "sig-r" } } },
            { type: "reasoning", text: "", providerOptions: { google: { thoughtSignature: "sig-empty" } } },
            { type: "text", text: "", providerOptions: { google: { thoughtSignature: "sig-empty" } } },
            { type: "text", text: "Answer.", providerOptions: { google: { thoughtSignature: "sig-t" } } },
            { type: "text", text: "Plain." },
          ],
        },
        userAsks("Two."),
      ],
    },
    response: googleHi,
  },
  {
    name: "vertex_signatures_are_read_too",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [
        userAsks("One."),
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "A.", providerOptions: { vertex: { thoughtSignature: "sig-v" } } },
            { type: "reasoning", text: "B.", providerOptions: { googleVertex: { thoughtSignature: "sig-gv" }, vertex: { thoughtSignature: "sig-v" } } },
            { type: "reasoning", text: "C.", providerOptions: { google: { thoughtSignature: "sig-g" }, vertex: { thoughtSignature: "sig-v" } } },
            { type: "tool-call", toolCallId: "n", toolName: "number_signature", input: { z: 1 }, providerOptions: { google: { thoughtSignature: 42 } } },
          ],
        },
      ],
    },
    response: googleHi,
  },
  {
    name: "gemma_takes_system_text_in_the_first_message",
    provider: "google",
    modelId: "google/gemma-3-27b",
    options: { prompt: [{ role: "system", content: "Be brief." }, { role: "system", content: "Be kind." }, userAsks("Hi.")] },
    response: googleHi,
  },
  {
    name: "structured_output",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [userAsks("JSON.")],
      responseFormat: {
        type: "json",
        name: "voice_turn",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["say", "tool", "instruction"],
          properties: { say: { type: "string" }, tool: { type: "string", enum: ["", "open"] }, instruction: { type: "string" } },
        },
      },
    },
    response: sse(googleChunk([{ text: "{\"say\":\"Hi\",\"tool\":\"\",\"instruction\":\"\"}" }]), googleDone()),
  },
  {
    name: "structured_output_without_schema",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("JSON.")], responseFormat: { type: "json" } },
    response: googleHi,
  },
  {
    name: "structured_output_turned_off",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: {
      prompt: [userAsks("JSON.")],
      responseFormat: { type: "json", schema: { type: "object", properties: { a: { type: "string" } } } },
      providerOptions: { google: { structuredOutputs: false } },
    },
    response: googleHi,
  },
  {
    name: "text_response_format_is_plain",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Hi.")], responseFormat: { type: "text" } },
    response: googleHi,
  },
  {
    name: "usage_with_cache_thoughts_and_extra_fields",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Hi.")] },
    response: sse(
      googleChunk([{ text: "Hi." }], { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }),
      googleDone("STOP", {
        promptTokenCount: 100,
        candidatesTokenCount: 10,
        cachedContentTokenCount: 40,
        thoughtsTokenCount: 5,
        totalTokenCount: 115,
        serviceTier: "flex",
        trafficType: "ON_DEMAND",
        toolUsePromptTokenCount: 3,
        promptTokensDetails: [{ modality: "TEXT", tokenCount: 100 }],
        candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 10 }],
      }),
    ),
  },
  {
    name: "max_tokens_finish",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Long.")], maxOutputTokens: 5 },
    response: sse(googleChunk([{ text: "Long" }]), googleDone("MAX_TOKENS")),
  },
  {
    name: "safety_block_on_the_prompt",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Bad.")] },
    response: sse({
      promptFeedback: { blockReason: "SAFETY", safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", probability: "HIGH", blocked: true, ignored: "dropped" }] },
      usageMetadata: { promptTokenCount: 3, totalTokenCount: 3 },
      responseId: "resp-google-blocked",
    }),
  },
  {
    name: "safety_finish_with_ratings_and_message",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Bad.")] },
    response: sse(
      {
        responseId: "resp-google-1",
        promptFeedback: { blockReason: null, safetyRatings: [] },
        candidates: [
          {
            finishReason: "SAFETY",
            finishMessage: "Blocked.",
            safetyRatings: [{ category: "HARM_CATEGORY_HATE_SPEECH", probability: "MEDIUM", probabilityScore: 0.5, severity: "HIGH", severityScore: 0.9, blocked: true, extra: "dropped" }],
          },
        ],
        usageMetadata: { promptTokenCount: 3 },
      },
    ),
  },
  { name: "recitation_finish", provider: "google", modelId: "google/gemini-2.5-flash", options: { prompt: [userAsks("Copy.")] }, response: sse(googleDone("RECITATION")) },
  { name: "prohibited_finish", provider: "google", modelId: "google/gemini-2.5-flash", options: { prompt: [userAsks("Copy.")] }, response: sse(googleDone("PROHIBITED_CONTENT")) },
  { name: "malformed_call_finish", provider: "google", modelId: "google/gemini-2.5-flash", options: { prompt: [userAsks("Call.")] }, response: sse(googleDone("MALFORMED_FUNCTION_CALL")) },
  { name: "other_finish", provider: "google", modelId: "google/gemini-2.5-flash", options: { prompt: [userAsks("Hm.")] }, response: sse(googleDone("LANGUAGE")) },
  {
    name: "grounding_metadata_kept_for_the_finish",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Hm.")] },
    response: sse(
      googleChunk([{ text: "Hi." }], {}, { urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://a.example", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }] }, groundingMetadata: { webSearchQueries: ["a"] } }),
      googleDone("STOP", { promptTokenCount: 1 }),
    ),
  },
  {
    name: "stream_ends_without_a_finish",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Hm.")] },
    response: sse(googleChunk([{ text: "Partial" }]), googleChunk([{ text: " answer", thought: true }])),
  },
  {
    name: "images_in_the_answer",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Draw.")] },
    response: sse(
      googleChunk([{ text: "Here." }, { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" }, thoughtSignature: "sig-file" }]),
      googleChunk([{ text: "Thought.", thought: true }, { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" }, thought: true }]),
      googleDone(),
    ),
  },
  {
    name: "malformed_chunk_mid_stream",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Go.")] },
    response: sse(googleChunk([{ text: "Fine" }]), "{not json", googleDone()),
  },
  {
    name: "usage_of_the_wrong_type",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Go.")] },
    response: sse(googleChunk([{ text: "Fine" }], { usageMetadata: { promptTokenCount: "many" } }), googleDone()),
  },
  {
    name: "part_shapes_decide_which_fields_count",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Go.")] },
    response: sse(
      googleChunk([
        { text: "Hidden by the image.", inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } },
        { text: "Hidden by the call.", functionCall: { id: "c1", name: "look", args: {} } },
        { text: "Kept, the image is malformed.", inlineData: { mimeType: 5 } },
      ]),
      googleDone(),
    ),
  },
  {
    name: "chunk_of_the_wrong_shape",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Go.")] },
    response: sse(googleChunk([{ text: "Fine" }]), { candidates: "nope" }, googleDone()),
  },
  {
    name: "parts_that_are_not_objects",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Go.")] },
    response: sse({ candidates: [{ content: { parts: ["nope"] } }] }, googleDone()),
  },
  {
    name: "key_echoed_in_a_failure",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Go.")] },
    status: 400,
    contentType: "application/json",
    response: JSON.stringify({ error: { code: 400, message: "Key test-key-parity is bad.", status: "INVALID_ARGUMENT" } }),
  },
  {
    name: "bad_request",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Go.")] },
    status: 400,
    contentType: "application/json",
    response: JSON.stringify({ error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT", details: [] } }),
  },
  {
    name: "rate_limited",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Go.")] },
    status: 429,
    contentType: "application/json",
    response: JSON.stringify({ error: { code: 429, message: "Slow down.", status: "RESOURCE_EXHAUSTED" } }),
  },
  {
    name: "server_error_with_an_unknown_shape",
    provider: "google",
    modelId: "google/gemini-2.5-flash",
    options: { prompt: [userAsks("Go.")] },
    status: 503,
    contentType: "text/plain",
    response: "upstream down",
  },
].map((item) => ({ ...item, fixtureProvider: "google" }) as SdkParityCase);

const gatewayEvents = (...parts: unknown[]) => sse(...parts);
const gatewayFinish = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 }, raw: { a: 1 } },
  providerMetadata: { gateway: { routing: { originalModelId: "openai/gpt-test" }, cost: "0.001" } },
};
const gatewayHi = gatewayEvents(
  { type: "stream-start", warnings: [] },
  { type: "response-metadata", id: "gen_1", modelId: "openai/gpt-test", timestamp: "2026-09-21T14:13:20Z" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Hi." },
  { type: "text-end", id: "t1" },
  gatewayFinish,
);
const gatewayFailure = (status: number, type: string, message: string, extra: Record<string, unknown> = {}) => ({
  provider: "gateway" as const,
  modelId: "gateway/openai/gpt-test",
  options: { prompt: [userAsks("Go.")] },
  status,
  contentType: "application/json",
  response: JSON.stringify({ error: { message, type }, ...extra }),
});

const gatewayCases: SdkParityCase[] = [
  { name: "text", provider: "gateway", modelId: "gateway/openai/gpt-test", options: { prompt: [{ role: "system", content: "Be brief." }, userAsks("Hi.")], maxOutputTokens: 100, temperature: 0.5, topP: 0.9, seed: 3, stopSequences: ["END"] }, response: gatewayHi },
  {
    name: "options_pass_through_with_routing",
    provider: "gateway",
    modelId: "gateway/anthropic/claude-test",
    reasoning: "high",
    options: {
      prompt: [
        { role: "system", content: "Be brief.", providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
        { role: "user", content: [{ type: "text", text: "Look." }, { type: "file", mediaType: "image/png", data: { type: "data", data: "iVBORw0KGgo=" } }] },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Thinking.", providerOptions: { anthropic: { signature: "sig" } } },
            { type: "text", text: "Calling." },
            { type: "tool-call", toolCallId: "a", toolName: "weather_forecast", input: { place: "Oslo" } },
          ],
        },
        toolResults({ id: "a", name: "weather_forecast", output: { type: "content", value: [{ type: "text", text: "Sunny." }, { type: "file", mediaType: "image/png", data: { type: "data", data: "iVBORw0KGgo=" } }] } }),
      ],
      tools: [weatherTool],
      toolChoice: { type: "auto" },
      responseFormat: { type: "json", name: "out", schema: { type: "object", properties: { a: { type: "string" } } } },
      providerOptions: { gateway: { models: ["gateway/openai/gpt-test", "anthropic/claude-test", 7], order: ["anthropic"] }, anthropic: { thinking: { type: "adaptive" } } },
    },
    response: gatewayHi,
  },
  {
    name: "routing_without_a_model_list",
    provider: "gateway",
    modelId: "gateway/openai/gpt-test",
    options: { prompt: [userAsks("Hi.")], providerOptions: { gateway: { order: ["openai"] } } },
    response: gatewayHi,
  },
  {
    name: "reasoning_and_tool_calls",
    provider: "gateway",
    modelId: "gateway/google/gemini-test",
    options: { prompt: [userAsks("Hi.")], tools: [weatherTool] },
    response: gatewayEvents(
      { type: "stream-start", warnings: [{ type: "other", message: "Careful." }] },
      { type: "response-metadata", id: "gen_2" },
      { type: "reasoning-start", id: "r1", providerMetadata: { google: { thoughtSignature: "s" } } },
      { type: "reasoning-delta", id: "r1", delta: "Hmm.", providerMetadata: { google: { thoughtSignature: "s" } } },
      { type: "reasoning-end", id: "r1", providerMetadata: { anthropic: { signature: "a" } } },
      { type: "text-start", id: "t1", providerMetadata: { openai: { itemId: "m1" } } },
      { type: "text-delta", id: "t1", delta: "Calling.", providerMetadata: { openai: { itemId: "m1" } } },
      { type: "text-end", id: "t1", providerMetadata: { openai: { itemId: "m1" } } },
      { type: "tool-input-start", id: "c1", toolName: "weather_forecast", providerMetadata: { google: { thoughtSignature: "s2" } } },
      { type: "tool-input-delta", id: "c1", delta: "{\"place\":\"Oslo\"}" },
      { type: "tool-input-end", id: "c1" },
      { type: "tool-call", toolCallId: "c1", toolName: "weather_forecast", input: "{\"place\":\"Oslo\"}", providerMetadata: { google: { thoughtSignature: "s2" } } },
      { ...gatewayFinish, finishReason: { unified: "tool-calls", raw: "tool_use" } },
    ),
  },
  {
    name: "other_parts_pass_through_and_raw_is_dropped",
    provider: "gateway",
    modelId: "gateway/openai/gpt-test",
    options: { prompt: [userAsks("Hi.")] },
    response: gatewayEvents(
      { type: "stream-start", warnings: [] },
      { type: "raw", rawValue: { secret: "no" } },
      { type: "source", sourceType: "url", id: "s1", url: "https://example.com", title: "Example" },
      { type: "file", mediaType: "image/png", data: { type: "data", data: "iVBORw0KGgo=" } },
      { type: "tool-call", toolCallId: "p1", toolName: "search", input: "{}", providerExecuted: true },
      { type: "tool-result", toolCallId: "p1", toolName: "search", result: { ok: true } },
      { type: "something-new", value: 1 },
      gatewayFinish,
    ),
  },
  {
    name: "error_part_does_not_end_the_stream",
    provider: "gateway",
    modelId: "gateway/openai/gpt-test",
    options: { prompt: [userAsks("Hi.")] },
    response: gatewayEvents({ type: "stream-start", warnings: [] }, { type: "error", error: { message: "Partial failure.", type: "internal_server_error" } }, { ...gatewayFinish, finishReason: { unified: "error" } }),
  },
  {
    name: "unreadable_event_ends_the_stream",
    provider: "gateway",
    modelId: "gateway/openai/gpt-test",
    options: { prompt: [userAsks("Hi.")] },
    response: gatewayEvents({ type: "stream-start", warnings: [] }, { type: "text-start", id: "t1" }, "{not json", { type: "text-end", id: "t1" }, gatewayFinish),
  },
  {
    name: "done_marker_is_ignored",
    provider: "gateway",
    modelId: "gateway/openai/gpt-test",
    options: { prompt: [userAsks("Hi.")] },
    response: gatewayEvents({ type: "stream-start", warnings: [] }, gatewayFinish, "[DONE]"),
  },
  {
    name: "key_echoed_in_an_error_part",
    provider: "gateway",
    modelId: "gateway/openai/gpt-test",
    options: { prompt: [userAsks("Hi.")] },
    response: gatewayEvents({ type: "stream-start", warnings: [] }, { type: "error", error: { message: "Key test-key-parity is bad.", nested: ["test-key-parity"] } }, gatewayFinish),
  },
  { name: "key_echoed_in_a_failure", ...gatewayFailure(400, "invalid_request_error", "Key test-key-parity is bad.") },
  { name: "auth_failure", ...gatewayFailure(401, "authentication_error", "Bad key test-key-parity") },
  { name: "invalid_request", ...gatewayFailure(400, "invalid_request_error", "Bad request.") },
  { name: "rate_limited", ...gatewayFailure(429, "rate_limit_exceeded", "Slow down.", { generationId: "gen_9" }) },
  { name: "model_not_found", ...gatewayFailure(404, "model_not_found", "No such model.") },
  { name: "forbidden", ...gatewayFailure(403, "forbidden", "Blocked.") },
  { name: "failed_dependency", ...gatewayFailure(424, "failed_dependency", "Upstream failed.") },
  { name: "internal_error", ...gatewayFailure(500, "internal_server_error", "Broken.") },
  { name: "unknown_error_shape", provider: "gateway", modelId: "gateway/openai/gpt-test", options: { prompt: [userAsks("Go.")] }, status: 502, contentType: "text/plain", response: "bad gateway" },
].map((item) => ({ ...item, fixtureProvider: "gateway" }) as SdkParityCase);

// Anthropic Messages. Events are written as the API writes them, with their `event:` lines.
const anthropicSse = (...events: unknown[]) =>
  events
    .flat()
    .map((event) => (typeof event === "string" ? `data: ${event}\n\n` : `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`))
    .join("");

const anthropicStart = (usage: Record<string, unknown> = { input_tokens: 12, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, message: Record<string, unknown> = {}) => ({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6-20260101", content: [], stop_reason: null, stop_sequence: null, usage, ...message },
});

const anthropicText = (index: number, ...pieces: string[]) => [
  { type: "content_block_start", index, content_block: { type: "text", text: "" } },
  ...pieces.map((text) => ({ type: "content_block_delta", index, delta: { type: "text_delta", text } })),
  { type: "content_block_stop", index },
];

const anthropicThinking = (index: number, thinking: string, signature: string) => [
  { type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking } },
  { type: "content_block_delta", index, delta: { type: "signature_delta", signature } },
  { type: "content_block_stop", index },
];

const anthropicToolUse = (index: number, id: string, name: string, ...pieces: string[]) => [
  { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } },
  ...pieces.map((partial_json) => ({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json } })),
  { type: "content_block_stop", index },
];

const anthropicEnd = (reason: string | null, usage: Record<string, unknown> = { output_tokens: 3 }, delta: Record<string, unknown> = {}) => [
  { type: "message_delta", delta: { stop_reason: reason, stop_sequence: null, ...delta }, usage },
  { type: "message_stop" },
];

const anthropicHi = anthropicSse(anthropicStart(), anthropicText(0, "Hi."), anthropicEnd("end_turn"));

const anthropicAsks = (name: string, modelId: string, options: Record<string, unknown>, extra: Partial<SdkParityCase> = {}): SdkParityCase => ({
  name,
  provider: "anthropic",
  modelId: `anthropic/${modelId}`,
  options: { prompt: [userAsks("Hi.")], ...options },
  response: anthropicHi,
  ...extra,
});

const anthropicFailure = (type: string, message: string) => ({ type: "error", error: { type, message } });

const parityScreenshot = { type: "file", data: { type: "data", data: "iVBORw0KGgo=" }, mediaType: "image/png" };
const anthropicCacheMark = { anthropic: { cacheControl: { type: "ephemeral" } } };
const parityRun: ModelMessage[] = [
  { role: "system", content: "Be brief." },
  { role: "user", content: [{ type: "text", text: "First." }, { type: "text", text: "Second." }] },
  { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool-call", toolCallId: "t1", toolName: "look", input: {} }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "look", output: { type: "text", value: "one" } }] },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "t2", toolName: "look", input: {} }, { type: "tool-call", toolCallId: "t3", toolName: "look", input: {} }] },
  {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: "t2", toolName: "look", output: { type: "text", value: "two" } },
      { type: "tool-result", toolCallId: "t3", toolName: "look", output: { type: "content", value: [{ type: "text", text: "three" }, parityScreenshot] } as never },
    ],
  },
];

const anthropicCases: SdkParityCase[] = [
  anthropicAsks("text", "claude-sonnet-4.6", { prompt: [{ role: "system", content: "Be brief." }, userAsks("Say hello.")], maxOutputTokens: 200, temperature: 0.2 }, {
    response: anthropicSse(anthropicStart(), "{\"type\":\"ping\"}", anthropicText(0, "Hel", "lo."), anthropicEnd("end_turn")),
  }),
  anthropicAsks("default_max_tokens_by_family", "claude-haiku-4-5", {}),
  anthropicAsks("unknown_model_warns_about_max_tokens", "claude-future-9", {}),
  anthropicAsks("legacy_model_is_unknown", "claude-3-5-sonnet", {}),
  anthropicAsks("compatible_model_keeps_top_p_with_temperature", "minimax-1", { temperature: 0.5, topP: 0.9, maxOutputTokens: 100 }),
  anthropicAsks("seed_and_stop_sequences", "claude-sonnet-4-6", { seed: 7, stopSequences: ["END"], maxOutputTokens: 10 }),
  anthropicAsks("temperature_above_one_clamps", "claude-haiku-4-5", { temperature: 1.5 }),
  anthropicAsks("temperature_below_zero_clamps", "claude-haiku-4-5", { temperature: -1 }),
  anthropicAsks("top_p_dropped_with_temperature", "claude-haiku-4-5", { temperature: 0.5, topP: 0.9 }),
  anthropicAsks("sampling_refused_by_newer_models", "claude-opus-5-5", { temperature: 0.5, topP: 0.9, maxOutputTokens: 100 }),
  anthropicAsks("max_tokens_capped_by_family", "claude-haiku-4-5", { maxOutputTokens: 100000 }),

  anthropicAsks("reasoning_adaptive_with_signature", "claude-sonnet-4-6", { temperature: 0.5, topP: 0.9, maxOutputTokens: 500 }, {
    reasoning: "low",
    response: anthropicSse(anthropicStart(), anthropicThinking(0, "Let me think.", "sig-abc"), anthropicText(1, "Done."), anthropicEnd("end_turn", { output_tokens: 20, output_tokens_details: { thinking_tokens: 15, extra: 1 } })),
  }),
  anthropicAsks("reasoning_minimal_maps_to_low", "claude-opus-4-7", {}, { reasoning: "minimal" }),
  anthropicAsks("reasoning_medium", "claude-opus-5-5", {}, { reasoning: "medium" }),
  anthropicAsks("reasoning_high", "claude-fable-5", {}, { reasoning: "high" }),
  anthropicAsks("reasoning_xhigh_kept_where_supported", "claude-opus-5-5", {}, { reasoning: "xhigh" }),
  anthropicAsks("reasoning_xhigh_maps_to_max", "claude-opus-4-6", {}, { reasoning: "xhigh" }),
  anthropicAsks("reasoning_none_disables_thinking", "claude-sonnet-5", {}, { reasoning: "none" }),
  anthropicAsks("reasoning_none_on_older_model", "claude-haiku-4-5", { temperature: 0.5 }, { reasoning: "none" }),
  anthropicAsks("reasoning_budget_minimal", "claude-sonnet-4-5", {}, { reasoning: "minimal" }),
  anthropicAsks("reasoning_budget_low_adds_to_max_tokens", "claude-sonnet-4-5", { maxOutputTokens: 1000, temperature: 0.2, topP: 0.5 }, { reasoning: "low" }),
  anthropicAsks("reasoning_budget_medium", "claude-haiku-4-5", { maxOutputTokens: 1000 }, { reasoning: "medium" }),
  anthropicAsks("reasoning_budget_high_capped", "claude-sonnet-4-5", { maxOutputTokens: 60000 }, { reasoning: "high" }),
  anthropicAsks("reasoning_budget_xhigh", "claude-opus-4-1", {}, { reasoning: "xhigh" }),
  anthropicAsks("reasoning_unknown_level_with_effort", "claude-sonnet-4-6", {}, { reasoning: "max" }),
  anthropicAsks("reasoning_unknown_level_with_budget", "claude-sonnet-4-5", {}, { reasoning: "max" }),
  anthropicAsks("reasoning_on_unknown_model", "claude-future-9", { maxOutputTokens: 100 }, { reasoning: "low" }),
  anthropicAsks("reasoning_on_compatible_model", "minimax-1", { maxOutputTokens: 100 }, { reasoning: "low" }),

  anthropicAsks("tool_call_streamed", "claude-sonnet-4-6", { prompt: [userAsks("Weather in Oslo?")], tools: [weatherTool], toolChoice: { type: "auto" } }, {
    response: anthropicSse(anthropicStart(), anthropicToolUse(0, "toolu_1", "weather_forecast", "", "{\"place\":", "\"Oslo\"}"), anthropicEnd("tool_use")),
  }),
  anthropicAsks("tool_call_with_no_input", "claude-sonnet-4-6", { tools: [weatherTool] }, {
    response: anthropicSse(anthropicStart(), anthropicToolUse(0, "toolu_1", "weather_forecast"), anthropicEnd("tool_use")),
  }),
  anthropicAsks("tool_input_on_block_start", "claude-sonnet-4-6", { tools: [weatherTool] }, {
    response: anthropicSse(
      anthropicStart(),
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "weather_forecast", input: { place: "Oslo" }, caller: { type: "direct" } } },
      { type: "content_block_stop", index: 0 },
      anthropicEnd("tool_use"),
    ),
  }),
  anthropicAsks("tool_call_in_message_start", "claude-sonnet-4-6", { tools: [weatherTool] }, {
    response: anthropicSse(
      anthropicStart(undefined, { content: [{ type: "tool_use", id: "toolu_1", name: "weather_forecast", input: { place: "Oslo", days: 2 }, caller: { type: "code_execution_20260120", tool_id: "srv_1" } }] }),
      anthropicEnd("tool_use"),
    ),
  }),
  anthropicAsks("parallel_tool_calls_with_text", "claude-sonnet-4-6", { prompt: [userAsks("Two places.")], tools: [weatherTool], toolChoice: { type: "required" } }, {
    response: anthropicSse(
      anthropicStart(),
      anthropicText(0, "Checking both."),
      anthropicToolUse(1, "toolu_a", "weather_forecast", "{\"place\":\"Oslo\"}"),
      anthropicToolUse(2, "toolu_b", "weather_forecast", "{\"place\":", "\"Rome\"}"),
      anthropicEnd("tool_use"),
    ),
  }),
  anthropicAsks("tool_choice_named", "claude-sonnet-4-6", { tools: [weatherTool], toolChoice: { type: "tool", toolName: "weather_forecast" } }),
  anthropicAsks("tool_choice_none_removes_tools", "claude-sonnet-4-6", { tools: [weatherTool], toolChoice: { type: "none" } }),
  anthropicAsks("strict_tool", "claude-sonnet-4-6", { tools: [{ ...weatherTool, strict: true }, { ...weatherTool, name: "loose", strict: false }] }),
  anthropicAsks("strict_tool_on_older_model_warns", "claude-sonnet-4-0", { tools: [{ ...weatherTool, strict: true }] }),
  anthropicAsks("empty_tools_list", "claude-sonnet-4-6", { tools: [], toolChoice: { type: "auto" } }),

  anthropicAsks("tool_result_kinds_merge_into_one_user_turn", "claude-sonnet-4-6", {
    prompt: [
      { role: "system", content: "Be brief." },
      userAsks("Go."),
      {
        role: "assistant",
        content: [
          { type: "text", text: "Working " },
          { type: "tool-call", toolCallId: "a", toolName: "one", input: { z: 1, a: { y: 2, b: 3 } } },
          { type: "tool-call", toolCallId: "b", toolName: "two", input: {} },
          { type: "tool-call", toolCallId: "c", toolName: "three", input: {} },
          { type: "tool-call", toolCallId: "d", toolName: "four", input: {} },
          { type: "tool-call", toolCallId: "e", toolName: "five", input: "not an object" },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "a", toolName: "one", output: { type: "json", value: { ok: true, list: [1, "two"] } } },
          { type: "tool-result", toolCallId: "b", toolName: "two", output: { type: "error-text", value: "It broke" } },
          { type: "tool-result", toolCallId: "c", toolName: "three", output: { type: "error-json", value: { code: 1 } } },
          { type: "tool-result", toolCallId: "d", toolName: "four", output: { type: "execution-denied" } },
          { type: "tool-result", toolCallId: "e", toolName: "five", output: { type: "execution-denied", reason: "Not allowed." } },
        ],
      },
      userAsks("And then?"),
    ],
  }),
  anthropicAsks("screenshot_stays_in_tool_result", "claude-sonnet-4-6", {
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
                parityScreenshot,
                { type: "file", data: { type: "data", data: "iVBORw0KGgo=" }, mediaType: "image/*" },
                { type: "file", data: { type: "url", url: "https://example.com/a.png" }, mediaType: "image/png" },
                { type: "file", data: { type: "url", url: "https://example.com/a.pdf" }, mediaType: "application/pdf" },
                { type: "file", data: { type: "data", data: "JVBERi0=" }, mediaType: "application/pdf" },
                { type: "file", data: { type: "data", data: "aGVsbG8=" }, mediaType: "text/plain" },
              ],
            },
          },
        ],
      },
    ],
  }),
  anthropicAsks("user_files", "claude-sonnet-4-6", {
    prompt: [
      {
        role: "user",
        content: [
          { type: "text", text: "What are these?" },
          { type: "file", data: { type: "data", data: "aGVsbG8=" }, mediaType: "image/jpeg" },
          { type: "file", data: { type: "data", data: "iVBORw0KGgo=" }, mediaType: "image/*" },
          { type: "file", data: { type: "url", url: "https://example.com/a.png" }, mediaType: "image/png" },
          { type: "file", data: { type: "data", data: "JVBERi0=" }, mediaType: "application/pdf" },
          { type: "file", data: { type: "url", url: "https://example.com/a.pdf" }, mediaType: "application/pdf" },
          { type: "file", data: { type: "data", data: "aGVsbG8gw6k=" }, mediaType: "text/plain" },
          { type: "file", data: { type: "url", url: "https://example.com/a.txt" }, mediaType: "text/plain" },
        ],
      },
    ],
  }),
  anthropicAsks("user_file_kind_unsupported", "claude-sonnet-4-6", { prompt: [{ role: "user", content: [{ type: "file", data: { type: "data", data: "aGVsbG8=" }, mediaType: "audio/mpeg" }] }] }),
  anthropicAsks("user_image_type_undetectable", "claude-sonnet-4-6", { prompt: [{ role: "user", content: [{ type: "file", data: { type: "data", data: "aGVsbG8=" }, mediaType: "image/*" }] }] }),

  anthropicAsks("cache_breakpoints_from_prompt_cache", "claude-sonnet-4-6", { prompt: withCacheBreakpoint(parityRun, "anthropic/claude-sonnet-4-6") }),
  anthropicAsks("cache_breakpoints_land_on_last_parts", "claude-sonnet-4-6", {
    prompt: [
      { role: "system", content: "One.", providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } } },
      { role: "system", content: "Two." },
      { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }], providerOptions: anthropicCacheMark },
      { role: "assistant", content: [{ type: "text", text: "c" }, { type: "tool-call", toolCallId: "t", toolName: "look", input: {} }], providerOptions: { anthropic: { cache_control: { type: "ephemeral" } } } },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "t", toolName: "look", output: { type: "text", value: "first" } },
          { type: "tool-result", toolCallId: "u", toolName: "look", output: { type: "content", value: [{ type: "text", text: "second" }, parityScreenshot] } },
        ],
        providerOptions: anthropicCacheMark,
      },
    ],
  }),
  anthropicAsks("cache_breakpoint_on_image_part", "claude-sonnet-4-6", {
    prompt: [{ role: "user", content: [{ type: "text", text: "a" }, parityScreenshot], providerOptions: anthropicCacheMark }],
  }),
  anthropicAsks("cache_breakpoint_on_each_merged_message", "claude-sonnet-4-6", {
    prompt: [
      { role: "user", content: [{ type: "text", text: "a" }], providerOptions: anthropicCacheMark },
      { role: "user", content: [{ type: "text", text: "b" }] },
      { role: "user", content: [{ type: "text", text: "c" }], providerOptions: anthropicCacheMark },
    ],
  }),
  anthropicAsks("cache_breakpoint_limit_warns", "claude-sonnet-4-6", {
    prompt: [
      { role: "system", content: "s", providerOptions: anthropicCacheMark },
      { role: "user", content: [{ type: "text", text: "a" }], providerOptions: anthropicCacheMark },
      { role: "user", content: [{ type: "text", text: "b" }], providerOptions: anthropicCacheMark },
      { role: "user", content: [{ type: "text", text: "c" }], providerOptions: anthropicCacheMark },
      { role: "user", content: [{ type: "text", text: "d" }], providerOptions: anthropicCacheMark },
    ],
  }),
  anthropicAsks("cache_breakpoint_lost_on_thinking", "claude-sonnet-4-6", {
    prompt: [
      userAsks("a"),
      { role: "assistant", content: [{ type: "reasoning", text: "Hmm.", providerOptions: { anthropic: { signature: "sig" } } }], providerOptions: anthropicCacheMark },
      userAsks("b"),
    ],
  }),
  anthropicAsks("cache_breakpoint_on_a_thinking_part_warns", "claude-sonnet-4-6", {
    prompt: [
      userAsks("a"),
      { role: "assistant", content: [{ type: "reasoning", text: "Hmm.", providerOptions: { anthropic: { signature: "sig", cacheControl: { type: "ephemeral" } } } }, { type: "text", text: "Yes." }] },
      userAsks("b"),
    ],
  }),
  anthropicAsks("cache_breakpoint_on_tool_call_part", "claude-sonnet-4-6", {
    prompt: [
      userAsks("a"),
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "t", toolName: "look", input: {}, providerOptions: anthropicCacheMark }, { type: "text", text: "after" }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "t", toolName: "look", output: { type: "text", value: "ok" } }] },
    ],
  }),

  anthropicAsks("thinking_goes_back_with_its_signature", "claude-sonnet-4-6", {
    prompt: [
      userAsks("Go."),
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "First thought.", providerOptions: { anthropic: { signature: "sig-1" } } },
          { type: "tool-call", toolCallId: "a", toolName: "one", input: {}, providerOptions: { anthropic: { caller: { type: "direct" } } } },
          { type: "text", text: "Moved before the call." },
          { type: "reasoning", text: "", providerOptions: { anthropic: { redactedData: "opaque" } } },
          { type: "tool-call", toolCallId: "b", toolName: "two", input: {}, providerOptions: { anthropic: { caller: { type: "code_execution_20250825", toolId: "srv" } } } },
          { type: "text", text: "Also moved." },
          { type: "reasoning", text: "No metadata, so it can't go back." },
          { type: "reasoning", text: "Other provider's.", providerOptions: { openai: { itemId: "rs_1" } } },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "a", toolName: "one", output: { type: "text", value: "1" } }, { type: "tool-result", toolCallId: "b", toolName: "two", output: { type: "text", value: "2" } }] },
    ],
  }),
  anthropicAsks("last_assistant_text_is_trimmed", "claude-sonnet-4-6", {
    prompt: [
      userAsks("Go."),
      { role: "assistant", content: [{ type: "text", text: " kept \n" }] },
      userAsks("More."),
      { role: "assistant", content: [{ type: "text", text: " also kept " }, { type: "text", text: " ﻿ trimmed \n\t" }] },
    ],
  }),
  anthropicAsks("system_after_the_first_message", "claude-sonnet-4-6", {
    prompt: [{ role: "system", content: "One." }, { role: "system", content: "Two." }, userAsks("a"), { role: "system", content: "Three." }, userAsks("b")],
  }),
  anthropicAsks("system_first_seen_later_is_hoisted", "claude-sonnet-4-6", {
    prompt: [userAsks("a"), { role: "system", content: "One." }, userAsks("b"), { role: "system", content: "Two." }],
  }),

  anthropicAsks("usage_with_cache_read_and_write", "claude-sonnet-4-6", {}, {
    response: anthropicSse(
      anthropicStart({ input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 700, cache_read_input_tokens: 9000, cache_creation: { ephemeral_5m_input_tokens: 700, ephemeral_1h_input_tokens: 0 }, service_tier: "standard" }),
      anthropicText(0, "Hi."),
      anthropicEnd("end_turn", { input_tokens: 6, output_tokens: 11, cache_creation_input_tokens: 800, cache_read_input_tokens: 9100, output_tokens_details: { thinking_tokens: 4 } }),
    ),
  }),
  anthropicAsks("usage_with_nulls_and_no_cache_fields", "claude-sonnet-4-6", {}, {
    response: anthropicSse(anthropicStart({ input_tokens: 5, cache_read_input_tokens: null }), anthropicText(0, "Hi."), anthropicEnd("end_turn", { output_tokens: 1, input_tokens: null, output_tokens_details: null, iterations: null })),
  }),
  anthropicAsks("usage_from_iterations", "claude-sonnet-4-6", {}, {
    response: anthropicSse(
      anthropicStart(),
      anthropicText(0, "Hi."),
      anthropicEnd("end_turn", {
        output_tokens: 3,
        iterations: [
          { type: "compaction", input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 5, extra: true },
          { type: "message", input_tokens: 20, output_tokens: 3, cache_creation_input_tokens: 7, cache_read_input_tokens: 0, model: null },
          { type: "advisor_message", model: "claude-opus-5", input_tokens: 999, output_tokens: 999 },
        ],
      }),
    ),
  }),
  anthropicAsks("usage_after_a_server_fallback", "claude-sonnet-4-6", {}, {
    response: anthropicSse(
      anthropicStart(),
      anthropicText(0, "Hi."),
      anthropicEnd("end_turn", {
        output_tokens: 3,
        iterations: [
          { type: "message", input_tokens: 40, output_tokens: 0 },
          { type: "fallback_message", model: "claude-sonnet-4-5", input_tokens: 12, output_tokens: 3 },
        ],
      }),
    ),
  }),
  anthropicAsks("usage_only_advisor_iterations", "claude-sonnet-4-6", {}, {
    response: anthropicSse(anthropicStart(), anthropicEnd("end_turn", { output_tokens: 3, iterations: [{ type: "advisor_message", input_tokens: 9, output_tokens: 9 }] })),
  }),
  anthropicAsks("message_stop_with_no_usage", "claude-sonnet-4-6", {}, { response: anthropicSse({ type: "message_stop" }) }),
  anthropicAsks("response_with_no_id_or_model", "claude-sonnet-4-6", {}, {
    response: anthropicSse({ type: "message_start", message: { usage: { input_tokens: 1 } } }, anthropicEnd("end_turn")),
  }),

  anthropicAsks("finish_length", "claude-sonnet-4-6", { maxOutputTokens: 2 }, { response: anthropicSse(anthropicStart(), anthropicText(0, "Cut"), anthropicEnd("max_tokens")) }),
  anthropicAsks("finish_context_window", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicStart(), anthropicEnd("model_context_window_exceeded")) }),
  anthropicAsks("finish_refusal", "claude-sonnet-4-6", {}, {
    response: anthropicSse(anthropicStart(), anthropicText(0, "No."), anthropicEnd("refusal", { output_tokens: 1 }, { stop_details: { type: "refusal", category: "cyber", explanation: "Because.", recommended_model: "claude-opus-5", extra: 1 } })),
  }),
  anthropicAsks("finish_refusal_with_few_details", "claude-sonnet-4-6", {}, {
    response: anthropicSse(anthropicStart(), anthropicEnd("refusal", { output_tokens: 1 }, { stop_details: { type: "refusal", category: null } })),
  }),
  anthropicAsks("finish_stop_sequence", "claude-sonnet-4-6", { stopSequences: ["END"] }, { response: anthropicSse(anthropicStart(), anthropicText(0, "Hi"), anthropicEnd("stop_sequence", { output_tokens: 1 }, { stop_sequence: "END" })) }),
  anthropicAsks("finish_pause_turn", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicStart(), anthropicEnd("pause_turn")) }),
  anthropicAsks("finish_compaction", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicStart(), anthropicEnd("compaction")) }),
  anthropicAsks("finish_reason_unknown", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicStart(), anthropicEnd("something_new")) }),
  anthropicAsks("finish_reason_missing", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicStart(), anthropicEnd(null)) }),
  anthropicAsks("stop_reason_in_message_start", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicStart(undefined, { stop_reason: "tool_use" }), { type: "message_stop" }) }),

  anthropicAsks("structured_output_native", "claude-sonnet-4-5", {
    prompt: [userAsks("List it.")],
    responseFormat: {
      type: "json",
      name: "answer",
      description: "The answer.",
      schema: {
        type: "object",
        title: "Answer",
        properties: {
          a: { type: "string", minLength: 2, format: "slug", description: "A thing." },
          when: { type: "string", format: "date-time" },
          count: { type: "integer", minimum: 1, exclusiveMaximum: 9, default: null },
          list: { type: "array", items: { type: "object", properties: { x: { const: "y" } } }, maxItems: 3, uniqueItems: true },
          either: { oneOf: [{ type: "string", pattern: "^a" }, { $ref: "#/$defs/thing", description: "Dropped." }] },
          every: { allOf: [{ type: "object" }] },
          no: { not: { type: "string" }, enum: ["a", "b"] },
        },
        required: ["a"],
        additionalProperties: true,
        $defs: { thing: { type: "object", minProperties: 1 } },
        definitions: { other: true },
      },
    },
  }, { response: anthropicSse(anthropicStart(), anthropicText(0, "{\"a\":\"b\"}"), anthropicEnd("end_turn")) }),
  anthropicAsks("structured_output_with_reasoning_and_tools", "claude-opus-5-5", {
    tools: [weatherTool],
    responseFormat: { type: "json", schema: { type: "object", properties: { a: { type: "string" } } } },
  }, { reasoning: "high" }),
  anthropicAsks("structured_output_by_tool_on_older_models", "claude-sonnet-4-0", {
    tools: [weatherTool],
    toolChoice: { type: "auto" },
    responseFormat: { type: "json", name: "answer", schema: { type: "object", minProperties: 1, properties: { z: { type: "string", minLength: 1 }, a: { type: "string" } }, required: ["z"] } },
  }, {
    response: anthropicSse(
      anthropicStart(),
      anthropicText(0, "Ignored text."),
      anthropicToolUse(1, "toolu_1", "json", "", "{\"z\":", "\"b\"}"),
      anthropicEnd("tool_use"),
    ),
  }),
  anthropicAsks("structured_output_by_tool_with_another_call", "claude-opus-4-0", {
    tools: [weatherTool],
    responseFormat: { type: "json", schema: { type: "object", properties: { a: { type: "string" } } } },
  }, {
    response: anthropicSse(
      anthropicStart(),
      anthropicToolUse(0, "toolu_1", "weather_forecast", "{\"place\":\"Oslo\"}"),
      anthropicToolUse(1, "toolu_2", "json", "{\"a\":\"b\"}"),
      anthropicToolUse(2, "toolu_3", "weather_forecast", "{\"place\":\"Rome\"}"),
      anthropicEnd("tool_use"),
    ),
  }),
  anthropicAsks("structured_output_with_no_schema", "claude-sonnet-4-6", { responseFormat: { type: "json" } }),
  anthropicAsks("response_format_text", "claude-sonnet-4-6", { responseFormat: { type: "text" } }),

  anthropicAsks("redacted_thinking", "claude-sonnet-4-6", {}, {
    reasoning: "low",
    response: anthropicSse(
      anthropicStart(),
      { type: "content_block_start", index: 0, content_block: { type: "redacted_thinking", data: "opaque" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "only-on-thinking" } },
      { type: "content_block_stop", index: 0 },
      anthropicText(1, "Done."),
      anthropicEnd("end_turn"),
    ),
  }),
  anthropicAsks("block_types_for_tools_misty_never_offers", "claude-sonnet-4-6", {}, {
    response: anthropicSse(
      anthropicStart(),
      { type: "content_block_start", index: 0, content_block: { type: "fallback" } },
      { type: "content_block_stop", index: 0 },
      anthropicText(1, "Hi."),
      anthropicEnd("end_turn"),
    ),
  }),
  anthropicAsks("deltas_for_blocks_never_started", "claude-sonnet-4-6", {}, {
    response: anthropicSse(
      anthropicStart(),
      { type: "content_block_delta", index: 7, delta: { type: "text_delta", text: "Orphan." } },
      { type: "content_block_delta", index: 8, delta: { type: "thinking_delta", thinking: "Orphan." } },
      { type: "content_block_delta", index: 9, delta: { type: "input_json_delta", partial_json: "{}" } },
      { type: "content_block_stop", index: 7 },
      anthropicEnd("end_turn"),
    ),
  }),

  anthropicAsks("overloaded_before_any_output", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicFailure("overloaded_error", "Overloaded")) }),
  anthropicAsks("api_error_before_any_output", "claude-sonnet-4-6", {}, { response: anthropicSse("{\"type\":\"ping\"}", anthropicFailure("api_error", "Broken")) }),
  anthropicAsks("error_echoing_the_key_before_any_output", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicFailure("api_error", "Bad key test-key-parity here")) }),
  anthropicAsks("malformed_chunk_before_any_output", "claude-sonnet-4-6", {}, { response: anthropicSse("{not json") }),
  anthropicAsks("invalid_chunk_before_any_output", "claude-sonnet-4-6", {}, { response: anthropicSse({ type: "something_new" }) }),
  anthropicAsks("overloaded_mid_stream", "claude-sonnet-4-6", {}, {
    response: anthropicSse(anthropicStart(), anthropicText(0, "Par"), anthropicFailure("overloaded_error", "Overloaded")),
  }),
  anthropicAsks("error_mid_stream_then_more", "claude-sonnet-4-6", {}, {
    response: anthropicSse(anthropicStart(), { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "error", error: { type: "api_error", message: "Hiccup test-key-parity", extra: 1 } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "more" } }, { type: "content_block_stop", index: 0 }, anthropicEnd("end_turn")),
  }),
  anthropicAsks("stream_ends_without_message_stop", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicStart(), anthropicText(0, "Par")) }),
  anthropicAsks("stream_with_no_events", "claude-sonnet-4-6", {}, { response: "" }),
  anthropicAsks("malformed_chunk_mid_stream", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicStart(), "{not json", anthropicText(0, "Fine."), anthropicEnd("end_turn")) }),
  anthropicAsks("invalid_chunks_mid_stream", "claude-sonnet-4-6", {}, {
    response: anthropicSse(
      anthropicStart(),
      { type: "something_new", a: 1 },
      { type: "content_block_start", index: 0, content_block: { type: "unknown_block" } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "unknown_delta" } },
      { type: "message_delta", delta: {}, usage: {} },
      anthropicText(0, "Fine."),
      anthropicEnd("end_turn"),
    ),
  }),
  anthropicAsks("message_start_repeated_with_the_same_id", "claude-sonnet-4-6", {}, { response: anthropicSse(anthropicStart(), anthropicStart(), anthropicText(0, "Hi."), anthropicEnd("end_turn")) }),
  anthropicAsks("message_start_with_another_id_stops_the_stream", "claude-sonnet-4-6", {}, {
    response: anthropicSse(anthropicStart(), anthropicStart(undefined, { id: "msg_2" }), anthropicText(0, "Ignored."), "{not json", anthropicEnd("end_turn")),
  }),
  anthropicAsks("second_message_after_stop", "claude-sonnet-4-6", {}, {
    response: anthropicSse(anthropicStart(), anthropicText(0, "One."), anthropicEnd("end_turn"), anthropicStart(undefined, { id: "msg_2" }), anthropicText(0, "Two."), anthropicEnd("max_tokens")),
  }),

  anthropicAsks("rate_limited", "claude-sonnet-4-6", {}, { status: 429, contentType: "application/json", response: JSON.stringify(anthropicFailure("rate_limit_error", "Slow down")) }),
  anthropicAsks("overloaded_status", "claude-sonnet-4-6", {}, { status: 529, contentType: "application/json", response: JSON.stringify(anthropicFailure("overloaded_error", "Overloaded")) }),
  anthropicAsks("server_error", "claude-sonnet-4-6", {}, { status: 500, contentType: "application/json", response: JSON.stringify(anthropicFailure("api_error", "Broken")) }),
  anthropicAsks("bad_request", "claude-sonnet-4-6", {}, { status: 400, contentType: "application/json", response: JSON.stringify(anthropicFailure("invalid_request_error", "Bad")) }),
  anthropicAsks("unauthorized_echoing_the_key", "claude-sonnet-4-6", {}, { status: 401, contentType: "application/json", response: JSON.stringify(anthropicFailure("authentication_error", "Key test-key-parity is invalid")) }),
  anthropicAsks("error_body_of_another_shape", "claude-sonnet-4-6", {}, { status: 503, contentType: "application/json", response: JSON.stringify({ error: { message: "Not Anthropic's shape" } }) }),
  anthropicAsks("error_body_not_json", "claude-sonnet-4-6", {}, { status: 502, contentType: "text/html", response: "<html>Bad gateway</html>" }),
  anthropicAsks("error_body_empty", "claude-sonnet-4-6", {}, { status: 500, contentType: "application/json", response: "" }),
].map((item) => ({ ...item, fixtureProvider: "anthropic" }));

// OpenAI Responses. Events carry their `event:` lines and sequence numbers as the API writes them.
const responsesSse = (...events: unknown[]) => {
  let sequence = 0;
  return events
    .flat()
    .map((event) => {
      if (typeof event === "string") return `data: ${event}\n\n`;
      const type = (event as { type: string }).type;
      return `event: ${type}\ndata: ${JSON.stringify({ ...(event as object), sequence_number: sequence++ })}\n\n`;
    })
    .join("");
};

const responsesObject = (extra: Record<string, unknown> = {}) => ({
  id: "resp_1",
  object: "response",
  created_at: 1_790_000_000,
  status: "in_progress",
  model: "gpt-5.1-2026-01-01",
  output: [],
  usage: null,
  ...extra,
});
const responsesOpen = [{ type: "response.created", response: responsesObject() }, { type: "response.in_progress", response: responsesObject() }];

const responsesUsage = { input_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 };
const responsesDone = (usage: Record<string, unknown> = responsesUsage, extra: Record<string, unknown> = {}) => ({
  type: "response.completed",
  response: responsesObject({ status: "completed", usage, ...extra }),
});

const responsesMessage = (index: number, id: string, ...pieces: string[]) => [
  { type: "response.output_item.added", output_index: index, item: { id, type: "message", status: "in_progress", role: "assistant", content: [] } },
  { type: "response.content_part.added", item_id: id, output_index: index, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
  ...pieces.map((delta) => ({ type: "response.output_text.delta", item_id: id, output_index: index, content_index: 0, delta, logprobs: [] })),
  { type: "response.output_text.done", item_id: id, output_index: index, content_index: 0, text: pieces.join(""), logprobs: [] },
  { type: "response.content_part.done", item_id: id, output_index: index, content_index: 0, part: { type: "output_text", text: pieces.join(""), annotations: [] } },
  { type: "response.output_item.done", output_index: index, item: { id, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: pieces.join(""), annotations: [] }] } },
];

const responsesCall = (index: number, id: string, callId: string, name: string, ...pieces: string[]) => [
  { type: "response.output_item.added", output_index: index, item: { id, type: "function_call", status: "in_progress", arguments: "", call_id: callId, name } },
  ...pieces.map((delta) => ({ type: "response.function_call_arguments.delta", item_id: id, output_index: index, delta })),
  { type: "response.function_call_arguments.done", item_id: id, output_index: index, arguments: pieces.join("") },
  { type: "response.output_item.done", output_index: index, item: { id, type: "function_call", status: "completed", arguments: pieces.join(""), call_id: callId, name } },
];

const responsesHi = responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Hi."), responsesDone());

const responsesAsks = (name: string, model: string, options: Record<string, unknown>, extra: Partial<SdkParityCase> = {}): SdkParityCase => ({
  name,
  provider: "openai",
  modelId: `openai/${model}`,
  options: { prompt: [userAsks("Hi.")], ...options },
  response: responsesHi,
  ...extra,
});

const responsesError = (message: string, type: string, code: string | null = null) => JSON.stringify({ error: { message, type, param: null, code } });

const openaiResponsesCases: SdkParityCase[] = [
  responsesAsks("text_with_system_role", "gpt-4o", { prompt: [{ role: "system", content: "Be brief." }, userAsks("Say hello.")], maxOutputTokens: 200, temperature: 0.2, topP: 0.9 }, {
    response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Hel", "lo."), responsesDone()),
  }),
  responsesAsks("reasoning_model_uses_developer_role", "gpt-5.1", { prompt: [{ role: "system", content: "Be brief." }, userAsks("Hi.")], temperature: 0.2, topP: 0.9 }),
  responsesAsks("custom_models_are_not_reasoning_models", "ft:gpt-5:me", { prompt: [{ role: "system", content: "Be brief." }, userAsks("Hi.")], temperature: 1 }, { reasoning: "low" }),
  responsesAsks("chat_variant_is_not_a_reasoning_model", "gpt-5-chat-latest", { prompt: [{ role: "system", content: "Be brief." }, userAsks("Hi.")] }, { reasoning: "low" }),
  responsesAsks("seed_and_stop_sequences_are_refused", "gpt-4o", { seed: 7, stopSequences: ["END"] }),

  responsesAsks("reasoning_summaries_with_encrypted_content", "gpt-5.1", { temperature: 0.2, topP: 0.5 }, {
    reasoning: "low",
    response: responsesSse(
      responsesOpen,
      { type: "response.output_item.added", output_index: 0, item: { id: "rs_1", type: "reasoning", encrypted_content: "enc-start", summary: [] } },
      { type: "response.reasoning_summary_part.added", item_id: "rs_1", output_index: 0, summary_index: 0, part: { type: "summary_text", text: "" } },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 0, delta: "First " },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 0, delta: "part." },
      { type: "response.reasoning_summary_text.done", item_id: "rs_1", output_index: 0, summary_index: 0, text: "First part." },
      { type: "response.reasoning_summary_part.done", item_id: "rs_1", output_index: 0, summary_index: 0, part: { type: "summary_text", text: "First part." } },
      { type: "response.reasoning_summary_part.added", item_id: "rs_1", output_index: 0, summary_index: 1, part: { type: "summary_text", text: "" } },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 1, delta: "Second." },
      { type: "response.reasoning_summary_part.done", item_id: "rs_1", output_index: 0, summary_index: 1, part: { type: "summary_text", text: "Second." } },
      { type: "response.output_item.done", output_index: 0, item: { id: "rs_1", type: "reasoning", encrypted_content: "enc-final", summary: [] } },
      responsesMessage(1, "msg_1", "Done."),
      responsesDone({ input_tokens: 10, input_tokens_details: { cached_tokens: 4 }, output_tokens: 9, output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 19 }),
    ),
  }),
  responsesAsks("reasoning_with_no_summary_and_no_encrypted_content", "gpt-5", {}, {
    reasoning: "minimal",
    response: responsesSse(
      responsesOpen,
      { type: "response.output_item.added", output_index: 0, item: { id: "rs_1", type: "reasoning", summary: [] } },
      { type: "response.output_item.done", output_index: 0, item: { id: "rs_1", type: "reasoning", summary: [] } },
      responsesMessage(1, "msg_1", "Done."),
      responsesDone(),
    ),
  }),
  responsesAsks("reasoning_medium", "o3", {}, { reasoning: "medium" }),
  responsesAsks("reasoning_high", "gpt-5.1-codex", {}, { reasoning: "high" }),
  responsesAsks("reasoning_xhigh", "gpt-5.2", {}, { reasoning: "xhigh" }),
  responsesAsks("reasoning_none_strips_sampling_on_gpt_5", "gpt-5", { temperature: 0.5, topP: 0.5 }, { reasoning: "none" }),
  responsesAsks("reasoning_none_keeps_sampling_from_gpt_5_1", "gpt-5.1", { temperature: 0.5, topP: 0.5 }, { reasoning: "none" }),
  responsesAsks("reasoning_ignored_on_other_models", "gpt-4o", { temperature: 0.5 }, { reasoning: "high" }),
  responsesAsks("reasoning_provider_default", "gpt-5.1", {}, { reasoning: "provider-default" }),

  responsesAsks("tool_call_streamed_with_strict_false", "gpt-5.1", { prompt: [userAsks("Weather in Oslo?")], tools: [weatherTool], toolChoice: { type: "auto" } }, {
    response: responsesSse(responsesOpen, responsesCall(0, "fc_1", "call_1", "weather_forecast", "{\"place\":", "\"Oslo\"}"), responsesDone()),
  }),
  responsesAsks("strict_stays_when_set", "gpt-5.1", { tools: [{ ...weatherTool, strict: true }, { ...weatherTool, name: "other", strict: false }, { ...weatherTool, name: "bare", description: undefined }] }),
  responsesAsks("tool_choice_required", "gpt-5.1", { tools: [weatherTool], toolChoice: { type: "required" } }),
  responsesAsks("tool_choice_none", "gpt-5.1", { tools: [weatherTool], toolChoice: { type: "none" } }),
  responsesAsks("tool_choice_named", "gpt-5.1", { tools: [weatherTool], toolChoice: { type: "tool", toolName: "weather_forecast" } }),
  responsesAsks("tool_choice_named_like_a_built_in_tool", "gpt-5.1", { tools: [{ ...weatherTool, name: "web_search" }], toolChoice: { type: "tool", toolName: "web_search" } }),
  responsesAsks("empty_tools_list", "gpt-5.1", { tools: [], toolChoice: { type: "auto" } }),
  responsesAsks("parallel_tool_calls_with_text", "gpt-5.1", { prompt: [userAsks("Two places.")], tools: [weatherTool] }, {
    response: responsesSse(
      responsesOpen,
      responsesMessage(0, "msg_1", "Checking both."),
      responsesCall(1, "fc_a", "call_a", "weather_forecast", "{\"place\":\"Oslo\"}"),
      responsesCall(2, "fc_b", "call_b", "weather_forecast", "{\"place\":", "\"Rome\"}"),
      responsesDone(),
    ),
  }),
  responsesAsks("calls_interleaved_by_output_index", "gpt-5.1", { tools: [weatherTool] }, {
    response: responsesSse(
      responsesOpen,
      { type: "response.output_item.added", output_index: 0, item: { id: "fc_a", type: "function_call", arguments: "", call_id: "call_a", name: "weather_forecast" } },
      { type: "response.output_item.added", output_index: 1, item: { id: "fc_b", type: "function_call", arguments: "", call_id: "call_b", name: "weather_forecast" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_a", output_index: 0, delta: "{}" },
      { type: "response.function_call_arguments.delta", item_id: "fc_b", output_index: 1, delta: "{\"a\":1}" },
      { type: "response.function_call_arguments.delta", item_id: "fc_x", output_index: 5, delta: "orphan" },
      { type: "response.output_item.done", output_index: 1, item: { id: "fc_b", type: "function_call", status: "completed", arguments: "{\"a\":1}", call_id: "call_b", name: "weather_forecast", caller: { type: "program", caller_id: "p1" }, namespace: null } },
      { type: "response.output_item.done", output_index: 0, item: { id: "fc_a", type: "function_call", status: "completed", arguments: "{}", call_id: "call_a", name: "weather_forecast", caller: { type: "direct" }, namespace: "tools" } },
      responsesDone(),
    ),
  }),
  responsesAsks("parallel_wrapper_expands", "gpt-5.1", { tools: [weatherTool, { ...weatherTool, name: "other" }] }, {
    response: responsesSse(
      responsesOpen,
      responsesCall(0, "fc_p", "call_p", "parallel", "{\"tool_uses\":[{\"recipient_name\":\"functions.weather_forecast\",\"parameters\":{\"place\":\"Oslo\",\"days\":1}},", "{\"recipient_name\":\"functions.other\",\"parameters\":{}}]}"),
      responsesDone(),
    ),
  }),
  responsesAsks("parallel_wrapper_with_an_unknown_recipient_stays_plain", "gpt-5.1", { tools: [weatherTool] }, {
    response: responsesSse(responsesOpen, responsesCall(0, "fc_p", "call_p", "parallel", "{\"tool_uses\":[{\"recipient_name\":\"functions.nope\",\"parameters\":{}}]}"), responsesDone()),
  }),
  responsesAsks("parallel_wrapper_with_no_deltas_stays_plain", "gpt-5.1", { tools: [weatherTool] }, {
    response: responsesSse(
      responsesOpen,
      { type: "response.output_item.done", output_index: 0, item: { id: "fc_p", type: "function_call", status: "completed", arguments: "not json", call_id: "call_p", name: "parallel" } },
      responsesDone(),
    ),
  }),
  responsesAsks("parallel_wrapper_that_never_finishes", "gpt-5.1", { tools: [weatherTool] }, {
    response: responsesSse(
      responsesOpen,
      { type: "response.output_item.added", output_index: 0, item: { id: "fc_p", type: "function_call", arguments: "", call_id: "call_p", name: "parallel" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_p", output_index: 0, delta: "{\"tool" },
      { type: "response.output_item.added", output_index: 1, item: { id: "fc_q", type: "function_call", arguments: "", call_id: "call_q", name: "weather_forecast" } },
    ),
  }),
  responsesAsks("a_declared_parallel_tool_is_an_ordinary_call", "gpt-5.1", { tools: [{ ...weatherTool, name: "parallel" }] }, {
    response: responsesSse(responsesOpen, responsesCall(0, "fc_p", "call_p", "parallel", "{}"), responsesDone()),
  }),

  responsesAsks("tool_result_kinds", "gpt-5.1", {
    prompt: [
      { role: "system", content: "Be brief." },
      userAsks("Go."),
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "a", toolName: "one", input: { z: 1, a: { y: 2, b: 3 } } },
          { type: "tool-call", toolCallId: "b", toolName: "two", input: {} },
          { type: "tool-call", toolCallId: "c", toolName: "three", input: {} },
          { type: "tool-call", toolCallId: "d", toolName: "four", input: {}, providerOptions: { openai: { itemId: "fc_d", namespace: "tools", caller: { type: "program", callerId: "p1" } } } },
          { type: "tool-call", toolCallId: "e", toolName: "five", input: {}, providerOptions: { openai: { caller: { type: "direct" } } } },
          { type: "tool-call", toolCallId: "f", toolName: "six", input: "plain text" },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "a", toolName: "one", output: { type: "text", value: "Rain" } },
          { type: "tool-result", toolCallId: "b", toolName: "two", output: { type: "json", value: { ok: true, list: [1, "two"] } } },
          { type: "tool-result", toolCallId: "c", toolName: "three", output: { type: "error-text", value: "It broke" } },
          { type: "tool-result", toolCallId: "d", toolName: "four", output: { type: "error-json", value: { code: 1 } } },
          { type: "tool-result", toolCallId: "e", toolName: "five", output: { type: "execution-denied" } },
          { type: "tool-result", toolCallId: "f", toolName: "six", output: { type: "execution-denied", reason: "Not allowed." } },
        ],
      },
    ],
  }),
  responsesAsks("screenshot_stays_in_tool_result", "gpt-5.1", {
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
                parityScreenshot,
                { type: "file", data: { type: "data", data: "iVBORw0KGgo=" }, mediaType: "image/*" },
                { type: "file", data: { type: "url", url: "https://example.com/a.png" }, mediaType: "image/png" },
                { type: "file", data: { type: "url", url: "https://example.com/a.pdf" }, mediaType: "application/pdf" },
                { type: "file", data: { type: "data", data: "JVBERi0=" }, mediaType: "application/pdf" },
              ],
            },
          },
        ],
      },
    ],
  }),
  responsesAsks("user_files", "gpt-4o", {
    prompt: [
      {
        role: "user",
        content: [
          { type: "text", text: "What are these?" },
          { type: "file", data: { type: "data", data: "aGVsbG8=" }, mediaType: "image/jpeg" },
          { type: "file", data: { type: "data", data: "iVBORw0KGgo=" }, mediaType: "image/*" },
          { type: "file", data: { type: "url", url: "https://example.com/a.png" }, mediaType: "image/png" },
          { type: "file", data: { type: "data", data: "file-abc123" }, mediaType: "image/png" },
          { type: "file", data: { type: "data", data: "JVBERi0=" }, mediaType: "application/pdf" },
          { type: "file", data: { type: "data", data: "file-def456" }, mediaType: "application/pdf" },
          { type: "file", data: { type: "url", url: "https://example.com/a.pdf" }, mediaType: "application/pdf" },
        ],
      },
    ],
  }),
  responsesAsks("user_file_kind_unsupported", "gpt-4o", { prompt: [{ role: "user", content: [{ type: "file", data: { type: "data", data: "aGVsbG8=" }, mediaType: "audio/mpeg" }] }] }),
  responsesAsks("user_image_type_undetectable", "gpt-4o", { prompt: [{ role: "user", content: [{ type: "file", data: { type: "data", data: "aGVsbG8=" }, mediaType: "image/*" }] }] }),

  responsesAsks("items_go_back_as_references", "gpt-5.1", {
    prompt: [
      userAsks("Go."),
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "One.", providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: "enc" } } },
          { type: "reasoning", text: "Two.", providerOptions: { openai: { itemId: "rs_1" } } },
          { type: "reasoning", text: "", providerOptions: { openai: { itemId: "rs_2", reasoningEncryptedContent: null } } },
          { type: "text", text: "Stored.", providerOptions: { openai: { itemId: "msg_1", phase: "commentary" } } },
          { type: "tool-call", toolCallId: "call_1", toolName: "one", input: { z: 1, a: 2 }, providerOptions: { openai: { itemId: "fc_1" } } },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call_1", toolName: "one", output: { type: "text", value: "ok" } }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Again.", providerOptions: { openai: { itemId: "rs_1" } } },
          { type: "text", text: "Done." },
        ],
      },
      userAsks("More."),
    ],
  }),
  responsesAsks("assistant_text_from_elsewhere", "gpt-5.1", {
    prompt: [
      userAsks("Go."),
      {
        role: "assistant",
        content: [
          { type: "text", text: " Not stored. ", providerOptions: { openai: { phase: "final_answer" } } },
          { type: "text", text: "Other provider's.", providerOptions: { anthropic: { something: true } } },
          { type: "reasoning", text: "Encrypted.", providerOptions: { openai: { reasoningEncryptedContent: "enc" } } },
          { type: "reasoning", text: "", providerOptions: { openai: { reasoningEncryptedContent: "enc2" } } },
          { type: "reasoning", text: "Nothing to send back." },
          { type: "reasoning", text: "Claude's.", providerOptions: { anthropic: { signature: "sig" } } },
        ],
      },
    ],
  }),

  responsesAsks("unstored_reasoning_asks_for_encrypted_content", "gpt-5.1", { providerOptions: { openai: { store: false } }, temperature: 0.5 }, {
    reasoning: "low",
    response: responsesSse(
      responsesOpen,
      { type: "response.output_item.added", output_index: 0, item: { id: "rs_1", type: "reasoning", encrypted_content: null } },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 0, delta: "Thinking." },
      { type: "response.reasoning_summary_part.done", item_id: "rs_1", output_index: 0, summary_index: 0 },
      { type: "response.output_item.done", output_index: 0, item: { id: "rs_1", type: "reasoning", encrypted_content: "enc-final" } },
      responsesMessage(1, "msg_1", "Done."),
      responsesDone(),
    ),
  }),
  responsesAsks("unstored_on_a_model_that_doesnt_reason", "gpt-4o", { providerOptions: { openai: { store: false } } }),
  responsesAsks("stored_on_request_concludes_reasoning_early", "gpt-5.1", { providerOptions: { openai: { store: true } } }, {
    reasoning: "low",
    response: responsesSse(
      responsesOpen,
      { type: "response.output_item.added", output_index: 0, item: { id: "rs_1", type: "reasoning" } },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 0, delta: "One." },
      { type: "response.reasoning_summary_part.done", item_id: "rs_1", output_index: 0, summary_index: 0 },
      { type: "response.reasoning_summary_part.added", item_id: "rs_1", output_index: 0, summary_index: 1 },
      { type: "response.reasoning_summary_part.done", item_id: "rs_1", output_index: 0, summary_index: 1 },
      { type: "response.output_item.done", output_index: 0, item: { id: "rs_1", type: "reasoning" } },
      responsesDone(),
    ),
  }),
  responsesAsks("unstored_items_go_back_whole", "gpt-5.1", {
    providerOptions: { openai: { store: false } },
    prompt: [
      userAsks("Go."),
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "One.", providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: "enc-1" } } },
          { type: "reasoning", text: "Two.", providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: "enc-2" } } },
          { type: "reasoning", text: "", providerOptions: { openai: { itemId: "rs_1" } } },
          { type: "reasoning", text: "", providerOptions: { openai: { itemId: "rs_2", reasoningEncryptedContent: "enc-3" } } },
          { type: "reasoning", text: "Dropped.", providerOptions: { openai: { itemId: "rs_3" } } },
          { type: "reasoning", text: "Kept.", providerOptions: { openai: { reasoningEncryptedContent: "enc-4" } } },
          { type: "text", text: "Sent whole.", providerOptions: { openai: { itemId: "msg_1", phase: "commentary" } } },
          { type: "tool-call", toolCallId: "call_1", toolName: "one", input: {}, providerOptions: { openai: { itemId: "fc_1" } } },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call_1", toolName: "one", output: { type: "text", value: "ok" } }] },
    ],
  }),

  responsesAsks("structured_output", "gpt-5.1", {
    prompt: [userAsks("List it.")],
    responseFormat: { type: "json", name: "answer", description: "The answer.", schema: { type: "object", properties: { z: { type: "string" }, a: { type: "string" } }, required: ["z", "a"], additionalProperties: false } },
  }, { response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "{\"z\":\"b\",", "\"a\":\"c\"}"), responsesDone()) }),
  responsesAsks("structured_output_with_default_name", "gpt-4o", { responseFormat: { type: "json", schema: { type: "object" } } }),
  responsesAsks("structured_output_with_no_schema", "gpt-4o", { responseFormat: { type: "json" } }),
  responsesAsks("response_format_text", "gpt-4o", { responseFormat: { type: "text" } }),

  responsesAsks("usage_with_cache_read_and_write", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Hi."), responsesDone({ input_tokens: 100, input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10, unknown: 1 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 8, unknown: 1 }, total_tokens: 120 }, { service_tier: "default", reasoning: { context: "ctx" } })),
  }),
  responsesAsks("usage_with_no_details", "gpt-5.1", {}, { response: responsesSse(responsesOpen, responsesDone({ input_tokens: 5, output_tokens: 1 })) }),
  responsesAsks("usage_with_null_details", "gpt-5.1", {}, { response: responsesSse(responsesOpen, responsesDone({ input_tokens: 5, input_tokens_details: null, output_tokens: 1, output_tokens_details: null })) }),
  responsesAsks("completed_with_no_usage_is_ignored", "gpt-5.1", {}, { response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Hi."), { type: "response.completed", response: responsesObject({ status: "completed", usage: null }) }) }),

  responsesAsks("finish_length", "gpt-5.1", { maxOutputTokens: 2 }, {
    response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Cut"), { type: "response.incomplete", response: responsesObject({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: responsesUsage }) }),
  }),
  responsesAsks("finish_content_filter", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, { type: "response.incomplete", response: responsesObject({ status: "incomplete", incomplete_details: { reason: "content_filter" }, usage: responsesUsage }) }),
  }),
  responsesAsks("finish_incomplete_for_another_reason", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, { type: "response.incomplete", response: responsesObject({ status: "incomplete", incomplete_details: { reason: "other_reason" }, usage: responsesUsage }) }),
  }),
  responsesAsks("finish_incomplete_after_a_call", "gpt-5.1", { tools: [weatherTool] }, {
    response: responsesSse(responsesOpen, responsesCall(0, "fc_1", "call_1", "weather_forecast", "{}"), { type: "response.incomplete", response: responsesObject({ status: "incomplete", incomplete_details: { reason: "other_reason" }, usage: responsesUsage }) }),
  }),
  responsesAsks("stream_ends_without_finishing", "gpt-5.1", {}, { response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Par")) }),
  responsesAsks("stream_with_no_events", "gpt-5.1", {}, { response: "" }),
  responsesAsks("done_marker_is_not_an_event", "gpt-5.1", {}, { response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Hi."), responsesDone(), "[DONE]") }),

  responsesAsks("message_phases", "gpt-5.1", {}, {
    response: responsesSse(
      responsesOpen,
      { type: "response.output_item.added", output_index: 0, item: { id: "msg_1", type: "message", phase: "commentary" } },
      { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: "One." },
      { type: "response.output_item.done", output_index: 0, item: { id: "msg_1", type: "message" } },
      { type: "response.output_item.added", output_index: 1, item: { id: "msg_2", type: "message" } },
      { type: "response.output_text.delta", item_id: "msg_2", output_index: 1, delta: "Two." },
      { type: "response.output_item.done", output_index: 1, item: { id: "msg_2", type: "message", phase: "final_answer" } },
      responsesDone(),
    ),
  }),
  responsesAsks("item_ids_rotating_between_events", "gpt-5.1", {}, {
    reasoning: "low",
    response: responsesSse(
      responsesOpen,
      { type: "response.output_item.added", output_index: 0, item: { id: "rs_stable", type: "reasoning" } },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_rotated", output_index: 0, summary_index: 0, delta: "Thinking." },
      { type: "response.reasoning_summary_part.done", item_id: "rs_rotated", output_index: 0, summary_index: 0 },
      { type: "response.output_item.done", output_index: 0, item: { id: "rs_rotated", type: "reasoning" } },
      { type: "response.output_item.added", output_index: 1, item: { id: "msg_stable", type: "message" } },
      { type: "response.output_text.delta", item_id: "msg_rotated", output_index: 1, delta: "Hi." },
      { type: "response.output_text.delta", item_id: "msg_no_index", delta: "Kept." },
      { type: "response.output_item.done", output_index: 1, item: { id: "msg_rotated", type: "message" } },
      responsesDone(),
    ),
  }),
  responsesAsks("malformed_known_events_are_ignored", "gpt-5.1", {}, {
    response: responsesSse(
      { type: "response.created", response: { id: "resp_1" } },
      responsesOpen,
      { type: "response.output_item.added", output_index: 0, item: { type: "message" } },
      { type: "response.output_item.added", output_index: 0, item: { id: "m", type: "message", phase: "unknown_phase" } },
      { type: "response.output_item.added", output_index: 0, item: { id: "x", type: "brand_new_item" } },
      { type: "response.output_text.delta", item_id: "msg_1" },
      { type: "response.brand_new_event", a: 1 },
      responsesMessage(0, "msg_1", "Hi."),
      { type: "response.output_item.done", output_index: 0, item: { id: "fc", type: "function_call", call_id: "c", name: "n", arguments: "{}" } },
      responsesDone(),
    ),
  }),

  responsesAsks("quota_error_before_any_output", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, { type: "error", error: { type: "insufficient_quota", code: "insufficient_quota", message: "Out of quota.", param: null } }),
  }),
  responsesAsks("error_event_before_any_output", "gpt-5.1", {}, { response: responsesSse({ type: "error", code: "server_error", message: "Broken.", param: null }) }),
  responsesAsks("error_event_with_a_status_code_before_any_output", "gpt-5.1", {}, { response: responsesSse({ type: "error", code: "503", message: "Broken." }) }),
  responsesAsks("error_event_echoing_the_key_before_any_output", "gpt-5.1", {}, { response: responsesSse({ type: "error", code: "invalid_api_key", message: "Bad key test-key-parity." }) }),
  responsesAsks("error_event_with_no_code_before_any_output", "gpt-5.1", {}, { response: responsesSse({ type: "error", message: "Broken." }) }),
  responsesAsks("failed_rate_limit_before_any_output", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, { type: "response.failed", response: responsesObject({ status: "failed", error: { code: "rate_limit_exceeded", message: "Slow down." }, usage: null }) }),
  }),
  responsesAsks("failed_server_error_before_any_output", "gpt-5.1", {}, {
    response: responsesSse({ type: "response.failed", response: responsesObject({ status: "failed", error: { code: "server_error", message: "Broken." } }) }),
  }),
  responsesAsks("failed_overloaded_before_any_output", "gpt-5.1", {}, {
    response: responsesSse({ type: "response.failed", response: responsesObject({ status: "failed", error: { code: "server_overloaded", message: "Busy." } }) }),
  }),
  responsesAsks("failed_with_no_error_before_any_output", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, { type: "response.failed", response: responsesObject({ status: "failed", error: null, usage: responsesUsage, reasoning: { context: "ctx" } }) }),
  }),
  responsesAsks("malformed_error_event_is_ignored", "gpt-5.1", {}, { response: responsesSse({ type: "error", nothing: true }, responsesOpen, responsesMessage(0, "msg_1", "Hi."), responsesDone()) }),

  responsesAsks("error_event_mid_stream", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Par"), { type: "error", code: "server_error", message: "Broken test-key-parity.", param: null, extra: 1 }, responsesMessage(1, "msg_2", "More")),
  }),
  responsesAsks("nested_error_event_mid_stream", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Par"), { type: "error", error: { type: "t", code: "c", message: "Broken.", extra: 1 } }),
  }),
  responsesAsks("failed_mid_stream", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Par"), { type: "response.failed", response: responsesObject({ status: "failed", service_tier: "default", error: { code: "server_error", message: "Broken.", extra: 1 }, usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 }, reasoning: { context: "ctx" } }) }),
  }),
  responsesAsks("failed_with_incomplete_details_mid_stream", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Par"), { type: "response.failed", response: responsesObject({ status: "failed", incomplete_details: { reason: "max_output_tokens" }, error: { message: "Too long." } }) }),
  }),
  responsesAsks("failed_with_no_error_mid_stream", "gpt-5.1", {}, {
    response: responsesSse(responsesOpen, responsesMessage(0, "msg_1", "Par"), { type: "response.failed", response: responsesObject({ status: "failed", error: null, incomplete_details: { reason: "content_filter" } }) }),
  }),
  responsesAsks("failed_twice_reports_once", "gpt-5.1", {}, {
    response: responsesSse(
      responsesOpen,
      responsesMessage(0, "msg_1", "Par"),
      { type: "error", code: "server_error", message: "First." },
      { type: "response.failed", response: responsesObject({ status: "failed", error: { message: "Second." } }) },
    ),
  }),
  responsesAsks("malformed_chunk_first", "gpt-5.1", {}, { response: responsesSse("{not json", responsesOpen, responsesMessage(0, "msg_1", "Hi."), responsesDone()) }),
  responsesAsks("malformed_chunk_mid_stream", "gpt-5.1", {}, { response: responsesSse(responsesOpen, "{not json", responsesMessage(0, "msg_1", "Hi."), responsesDone()) }),
  responsesAsks("chunk_with_no_type", "gpt-5.1", {}, { response: responsesSse(responsesOpen, "{\"z\":1,\"a\":2}", "[1,2]", "7", responsesMessage(0, "msg_1", "Hi."), responsesDone()) }),
  responsesAsks("chat_completions_answering_instead", "gpt-5.1", {}, {
    response: responsesSse("{\"id\":\"chatcmpl-1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hi\"}}],\"model\":\"m\"}"),
  }),

  responsesAsks("rate_limited", "gpt-5.1", {}, { status: 429, contentType: "application/json", response: responsesError("Slow down", "rate_limit_error", "rate_limit_exceeded") }),
  responsesAsks("server_error", "gpt-5.1", {}, { status: 500, contentType: "application/json", response: responsesError("Broken", "server_error") }),
  responsesAsks("bad_request", "gpt-5.1", {}, { status: 400, contentType: "application/json", response: responsesError("Bad", "invalid_request_error") }),
  responsesAsks("error_with_a_numeric_code", "gpt-5.1", {}, { status: 503, contentType: "application/json", response: JSON.stringify({ error: { message: "Busy", code: 503 } }) }),
  responsesAsks("unauthorized_echoing_the_key", "gpt-5.1", {}, { status: 401, contentType: "application/json", response: responsesError("Incorrect API key: test-key-parity", "invalid_request_error", "invalid_api_key") }),
  responsesAsks("error_body_of_another_shape", "gpt-5.1", {}, { status: 503, contentType: "application/json", response: JSON.stringify({ message: "Not OpenAI's shape" }) }),
  responsesAsks("error_body_with_a_numeric_type", "gpt-5.1", {}, { status: 500, contentType: "application/json", response: JSON.stringify({ error: { message: "No", type: 5 } }) }),
  responsesAsks("error_body_not_json", "gpt-5.1", {}, { status: 502, contentType: "text/html", response: "<html>Bad gateway</html>" }),
  responsesAsks("error_body_empty", "gpt-5.1", {}, { status: 500, contentType: "application/json", response: "" }),
].map((item) => ({ ...item, fixtureProvider: "openai-responses" }));

const chatgptCompleted = (text: string) => ({
  id: "resp_1",
  object: "response",
  created_at: 1_790_000_000,
  model: "gpt-test",
  status: "completed",
  incomplete_details: null,
  output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
  usage: { input_tokens: 5, output_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
});

const chatgptEvents = (...events: Array<Record<string, unknown>>) =>
  events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");

const chatgptHi = chatgptEvents(
  { type: "response.created", response: { id: "resp_1", created_at: 1_790_000_000, model: "gpt-test" } },
  { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] } },
  { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "Hi" },
  { type: "response.output_item.done", output_index: 0, item: chatgptCompleted("Hi").output[0] },
  { type: "response.completed", response: chatgptCompleted("Hi") },
);

const chatgptCases: SdkParityCase[] = [
  {
    name: "shaped_text",
    provider: "chatgpt",
    modelId: "chatgpt/gpt-test",
    options: {
      prompt: [{ role: "system", content: "You are Misty." }, { role: "system", content: "Be brief." }, userAsks("Say hello")],
      maxOutputTokens: 500,
      temperature: 0.2,
      topP: 0.9,
      providerOptions: { openai: { user: "someone", metadata: { a: "b" }, previousResponseId: "resp_0" }, gateway: { models: ["x"] } },
    },
    response: chatgptHi,
  },
  {
    name: "tools_stay_loose_unless_asked",
    provider: "chatgpt",
    modelId: "chatgpt/gpt-test",
    options: {
      prompt: [userAsks("Weather?")],
      tools: [weatherTool, { ...weatherTool, name: "strict_one", strict: true }],
      toolChoice: { type: "auto" },
    },
    response: chatgptHi,
  },
  {
    name: "reasoning_model",
    provider: "chatgpt",
    modelId: "chatgpt/gpt-5.1",
    reasoning: "high",
    options: { prompt: [{ role: "system", content: "Think hard." }, userAsks("Think.")] },
    response: chatgptHi,
  },
  {
    name: "tool_call_and_results",
    provider: "chatgpt",
    modelId: "chatgpt/gpt-test",
    options: {
      prompt: [
        userAsks("Weather?"),
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "call_1", toolName: "weather_forecast", input: { place: "Oslo" } }] },
        toolResults({ id: "call_1", name: "weather_forecast", output: { type: "text", value: "Sunny." } }),
      ],
      tools: [weatherTool],
    },
    response: chatgptEvents(
      { type: "response.created", response: { id: "resp_1", created_at: 1_790_000_000, model: "gpt-test" } },
      { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_2", name: "weather_forecast", arguments: "", status: "in_progress" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "{\"place\":\"Rome\"}" },
      { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_2", name: "weather_forecast", arguments: "{\"place\":\"Rome\"}", status: "completed" } },
      { type: "response.completed", response: { ...chatgptCompleted(""), output: [] } },
    ),
  },
  {
    name: "plan_limit_in_the_stream",
    provider: "chatgpt",
    modelId: "chatgpt/gpt-test",
    options: { prompt: [userAsks("Hi.")] },
    response: chatgptEvents({
      type: "response.failed",
      response: { id: "resp_1", status: "failed", error: { code: "subscription_sharing_usage_limit_exceeded", message: "Limit reached" } },
    }),
  },
  {
    name: "rejected_token",
    provider: "chatgpt",
    modelId: "chatgpt/gpt-test",
    options: { prompt: [userAsks("Hi.")] },
    status: 401,
    contentType: "application/json",
    response: JSON.stringify({ error: { message: "Bad token.", type: "invalid_request_error", code: "invalid_api_key" } }),
  },
].map((item) => ({ ...item, fixtureProvider: "chatgpt" }) as SdkParityCase);

/** A second's worth of nothing in a WAV file, as `src/voice/models.ts` makes. */
const wavBase64 = Buffer.concat([Buffer.from("RIFF"), Buffer.from([36, 0, 0, 0]), Buffer.from("WAVEfmt "), Buffer.alloc(8)]).toString("base64");
const mp3Base64 = Buffer.from([255, 251, 144, 0, 1, 2]).toString("base64");
const rawPcmBase64 = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString("base64");
const jsonReply = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const binaryReply = (base64: string) => ({ status: 200, contentType: "application/octet-stream", bodyBase64: base64 });

/** The options `embedCall` in `src/model-calls.ts` sends for a dimension count. */
const embedDimensions = (dimensions: number) => ({
  ...Object.fromEntries(["openai", "openai-compatible", "openrouter", "nvidia", "ollama"].map((name) => [name, { dimensions }])),
  google: { outputDimensionality: dimensions },
});

const embedCases: SdkParityCase[] = [
  { name: "embed_openai", provider: "openai", modelId: "openai/text-embedding-3-small", input: { values: ["one", "two"], providerOptions: embedDimensions(256) }, replies: [jsonReply({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 1] }], usage: { prompt_tokens: 7 } })] },
  { name: "embed_openai_without_options", provider: "openai", modelId: "openai/text-embedding-3-small", input: { values: ["one"] }, replies: [jsonReply({ data: [{ embedding: [0.5] }] })] },
  { name: "embed_openai_user", provider: "openai", modelId: "openai/text-embedding-3-small", input: { values: ["one"], providerOptions: { openai: { user: "u1" } } }, replies: [jsonReply({ data: [{ embedding: [0.5] }], usage: null })] },
  { name: "embed_nvidia", provider: "nvidia", modelId: "nvidia/nv-embed", input: { values: ["one"], providerOptions: embedDimensions(128) }, replies: [jsonReply({ data: [{ embedding: [0.5] }], usage: { prompt_tokens: 2 }, providerMetadata: { nvidia: { kept: true } } })] },
  { name: "embed_openrouter", provider: "openrouter", modelId: "openrouter/some/embed", input: { values: ["one"], providerOptions: embedDimensions(128) }, replies: [jsonReply({ data: [{ embedding: [0.5] }] })] },
  { name: "embed_ollama_cloud_reads_no_listed_options", provider: "ollama-cloud", modelId: "ollama-cloud/nomic", input: { values: ["one"], providerOptions: embedDimensions(128) }, replies: [jsonReply({ data: [{ embedding: [0.5] }] })] },
  { name: "embed_openai_compatible_warns_about_its_key", provider: "openai-compatible", modelId: "openai-compatible/local", input: { values: ["one"], providerOptions: { "openai-compatible": { dimensions: 64 } } }, replies: [jsonReply({ data: [{ embedding: [0.5] }] })] },
  { name: "embed_compatible_camel_case_key", provider: "ollama", modelId: "ollama/nomic", input: { values: ["one"], providerOptions: { openaiCompatible: { dimensions: 64 }, ollama: { user: "me" } } }, replies: [jsonReply({ data: [{ embedding: [0.5] }] })] },
  { name: "embed_google_single", provider: "google", modelId: "google/gemini-embedding-001", input: { values: ["one"], providerOptions: embedDimensions(64) }, replies: [jsonReply({ embedding: { values: [0.1, 0.2] } })] },
  { name: "embed_google_batch", provider: "google", modelId: "gemini/gemini-embedding-001", input: { values: ["one", "two"], providerOptions: { google: { taskType: "RETRIEVAL_DOCUMENT" } } }, replies: [jsonReply({ embeddings: [{ values: [0.1] }, { values: [0.2] }] })] },
  {
    name: "embed_google_images",
    provider: "google",
    modelId: "google/gemini-embedding-2",
    input: { values: ["", "two"], providerOptions: { google: { content: [[{ inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } }], null] } } },
    replies: [jsonReply({ embeddings: [{ values: [0.1] }, { values: [0.2] }] })],
  },
  {
    name: "embed_google_single_image",
    provider: "google",
    modelId: "google/gemini-embedding-2",
    input: { values: ["caption"], providerOptions: { google: { outputDimensionality: 8, content: [[{ inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } }]] } } },
    replies: [jsonReply({ embedding: { values: [0.1] } })],
  },
  { name: "embed_google_splits_past_a_hundred", provider: "google", modelId: "google/gemini-embedding-001", input: { values: Array.from({ length: 101 }, (_, index) => `v${index}`) }, replies: [jsonReply({ embeddings: [{ values: [0.1] }], embedding: { values: [0.1] } })], unorderedRequests: true },
  { name: "embed_gateway", provider: "gateway", modelId: "gateway/openai/text-embedding-3-small", input: { values: ["one", "two"], providerOptions: embedDimensions(32) }, replies: [jsonReply({ embeddings: [[0.1], [0.2]], usage: { tokens: 4 }, warnings: [{ type: "other", message: "Careful." }], providerMetadata: { gateway: { cost: "0.1" } } })] },
  { name: "embed_gateway_without_options", provider: "gateway", modelId: "gateway/openai/text-embedding-3-small", input: { values: ["one"] }, replies: [jsonReply({ embeddings: [[0.1]] })] },
  { name: "embed_unreadable_answer", provider: "openai", modelId: "openai/text-embedding-3-small", input: { values: ["one"] }, replies: [jsonReply({ data: "nope" })] },
  { name: "embed_rate_limited", provider: "openai", modelId: "openai/text-embedding-3-small", input: { values: ["one"] }, replies: [jsonReply({ error: { message: "Slow down." } }, 429)] },
  { name: "embed_google_rejected", provider: "google", modelId: "google/gemini-embedding-001", input: { values: ["one"] }, replies: [jsonReply({ error: { code: 400, message: "Bad.", status: "INVALID_ARGUMENT" } }, 400)] },
  { name: "embed_compatible_failure", provider: "nvidia", modelId: "nvidia/nv-embed", input: { values: ["one"] }, replies: [jsonReply({ error: { message: "Down." } }, 503)] },
  { name: "embed_gateway_failure", provider: "gateway", modelId: "gateway/x/y", input: { values: ["one"] }, replies: [jsonReply({ error: { message: "No.", type: "forbidden" } }, 403)] },
].map((item) => ({ ...item, kind: "embed", options: {}, response: "", fixtureProvider: "media" }) as SdkParityCase);

const speechCases: SdkParityCase[] = [
  { name: "speech_openai_for_the_voice_pipeline", provider: "openai", modelId: "openai/gpt-4o-mini-tts", input: { text: "Hello.", voice: "alloy", outputFormat: "pcm" }, replies: [binaryReply(rawPcmBase64)] },
  { name: "speech_openai_defaults", provider: "openai", modelId: "openai/tts-1", input: { text: "Hello." }, replies: [binaryReply(mp3Base64)] },
  { name: "speech_openai_warns", provider: "openai", modelId: "openai/tts-1", input: { text: "Hello.", voice: "nova", outputFormat: "weird", language: "de", speed: 1.5, instructions: "Softly." }, replies: [binaryReply(wavBase64)] },
  { name: "speech_elevenlabs_with_neighbours", provider: "elevenlabs", modelId: "elevenlabs/eleven_flash_v2_5", input: { text: "Middle.", voice: "voice_1", outputFormat: "pcm_24000", providerOptions: { elevenlabs: { previousText: "Before.", nextText: "After." } } }, replies: [binaryReply(rawPcmBase64)] },
  { name: "speech_elevenlabs_default_voice", provider: "elevenlabs", modelId: "elevenlabs/eleven_flash_v2_5", input: { text: "Hello.", outputFormat: "pcm_24000" }, replies: [binaryReply(rawPcmBase64)] },
  { name: "speech_elevenlabs_format_names", provider: "elevenlabs", modelId: "elevenlabs/eleven_flash_v2_5", input: { text: "Hello.", outputFormat: "mp3", language: "de", speed: 1.2, instructions: "Softly." }, replies: [binaryReply(mp3Base64)] },
  { name: "speech_gateway", provider: "gateway", modelId: "gateway/openai/tts-1", input: { text: "Hello.", voice: "alloy", outputFormat: "pcm", speed: 1.1, language: "en", instructions: "Softly.", providerOptions: { openai: { a: 1 } } }, replies: [jsonReply({ audio: mp3Base64, warnings: [{ type: "other", message: "Careful." }], providerMetadata: { gateway: { cost: "0.1" } } })] },
  { name: "speech_gateway_plain", provider: "gateway", modelId: "gateway/openai/tts-1", input: { text: "Hello." }, replies: [jsonReply({ audio: rawPcmBase64 })] },
  { name: "speech_no_audio", provider: "openai", modelId: "openai/tts-1", input: { text: "Hello." }, replies: [binaryReply("")] },
  { name: "speech_openai_failure", provider: "openai", modelId: "openai/tts-1", input: { text: "Hello." }, replies: [jsonReply({ error: { message: "Bad voice." } }, 400)] },
  { name: "speech_elevenlabs_failure", provider: "elevenlabs", modelId: "elevenlabs/eleven_flash_v2_5", input: { text: "Hello." }, replies: [jsonReply({ error: { message: "No key.", code: 401 } }, 401)] },
  { name: "speech_elevenlabs_other_failure_shape", provider: "elevenlabs", modelId: "elevenlabs/eleven_flash_v2_5", input: { text: "Hello." }, replies: [jsonReply({ detail: { status: "quota_exceeded" } }, 429)] },
  { name: "speech_gateway_failure", provider: "gateway", modelId: "gateway/x/y", input: { text: "Hello." }, replies: [jsonReply({ error: { message: "Slow down.", type: "rate_limit_exceeded" } }, 429)] },
].map((item) => ({ ...item, kind: "speech", options: {}, response: "", fixtureProvider: "media" }) as SdkParityCase);

const sonioxFlow = (transcript: unknown, status: unknown = { id: "job-1", status: "completed", audio_duration_ms: 1500 }, deleted: Array<{ status: number; contentType: string; body: string }> = []) => [
  jsonReply({ id: "file-1" }),
  jsonReply({ id: "job-1", status: "queued" }),
  jsonReply(status),
  jsonReply(transcript),
  ...deleted,
  { status: 204, contentType: "text/plain", body: "" },
];

const transcribeCases: SdkParityCase[] = [
  { name: "transcribe_whisper", provider: "openai", modelId: "openai/whisper-1", input: { audioBase64: wavBase64 }, replies: [jsonReply({ text: "Hello.", language: "english", duration: 1.5, segments: [{ id: 0, seek: 0, start: 0, end: 1.5, text: "Hello.", tokens: [1], temperature: 0, avg_logprob: 0, compression_ratio: 1, no_speech_prob: 0 }] })] },
  { name: "transcribe_gpt_model_mp3", provider: "openai", modelId: "openai/gpt-4o-transcribe", input: { audioBase64: mp3Base64 }, replies: [jsonReply({ text: "Hello." })] },
  { name: "transcribe_words_and_unknown_language", provider: "openai", modelId: "openai/gpt-4o-mini-transcribe", input: { audioBase64: rawPcmBase64 }, replies: [jsonReply({ text: "Hi there", language: "klingon", words: [{ word: "Hi", start: 0, end: 0.5 }, { word: "there", start: 0.5, end: 1 }] })] },
  { name: "transcribe_realtime_model_refused", provider: "openai", modelId: "openai/gpt-realtime-whisper", input: { audioBase64: wavBase64 }, replies: [jsonReply({ text: "" })] },
  { name: "transcribe_empty_text", provider: "openai", modelId: "openai/whisper-1", input: { audioBase64: wavBase64 }, replies: [jsonReply({ text: "" })] },
  { name: "transcribe_openai_failure", provider: "openai", modelId: "openai/whisper-1", input: { audioBase64: wavBase64 }, replies: [jsonReply({ error: { message: "Too long." } }, 413)] },
  { name: "transcribe_gateway", provider: "gateway", modelId: "gateway/openai/whisper-1", input: { audioBase64: wavBase64 }, replies: [jsonReply({ text: "Hello.", segments: [{ text: "Hello.", startSecond: 0, endSecond: 1 }], language: "en", durationInSeconds: 1, warnings: [{ type: "other", message: "Careful." }], providerMetadata: { gateway: { cost: "0.1" } } })] },
  { name: "transcribe_gateway_plain", provider: "gateway", modelId: "gateway/openai/whisper-1", input: { audioBase64: mp3Base64, providerOptions: { openai: { language: "en" } } }, replies: [jsonReply({ text: "Hello." })] },
  { name: "transcribe_gateway_failure", provider: "gateway", modelId: "gateway/x/y", input: { audioBase64: wavBase64 }, replies: [jsonReply({ error: { message: "No model.", type: "model_not_found" } }, 404)] },
  {
    name: "transcribe_soniox_with_speakers",
    provider: "soniox",
    modelId: "soniox/stt-async-v4",
    input: {
      audioBase64: wavBase64,
      providerOptions: { soniox: { enableSpeakerDiarization: true, enableLanguageIdentification: true, languageHints: ["en", "de"], context: { text: "A talk.", terms: ["Misty"] } } },
    },
    replies: sonioxFlow({
      id: "job-1",
      text: "Hello there.",
      tokens: [
        { text: "Hello", start_ms: 0, end_ms: 500, confidence: 0.9, speaker: "1", language: "en", extra: "dropped" },
        { text: " there.", start_ms: 500, end_ms: 1000, confidence: 0.8, speaker: 2, language: "de" },
        { text: " there", start_ms: 1000, end_ms: 1200, language: "de", translation_status: "none" },
        { text: "<end>" },
      ],
    }),
  },
  { name: "transcribe_soniox_plain", provider: "soniox", modelId: "soniox/stt-async-v4", input: { audioBase64: mp3Base64, providerOptions: { soniox: { context: "Plain context.", translation: { type: "two_way", languageA: "en", languageB: "de" } } } }, replies: sonioxFlow({ id: "job-1", text: "Hi." }, { id: "job-1", status: "completed" }) },
  {
    name: "transcribe_soniox_waits_for_the_job",
    provider: "soniox",
    modelId: "soniox/stt-async-v4",
    input: { audioBase64: wavBase64 },
    replies: [jsonReply({ id: "file-1" }), jsonReply({ id: "job-1" }), jsonReply({ id: "job-1", status: "processing" }), jsonReply({ id: "job-1", status: "completed", audio_duration_ms: 250 }), jsonReply({ id: "job-1", text: "Hi.", tokens: [] }), { status: 204, contentType: "text/plain", body: "" }],
  },
  { name: "transcribe_soniox_job_fails_and_is_cleaned_up", provider: "soniox", modelId: "soniox/stt-async-v4", input: { audioBase64: wavBase64 }, replies: [jsonReply({ id: "file-1" }), jsonReply({ id: "job-1" }), jsonReply({ id: "job-1", status: "error", error_message: "Bad audio." }), { status: 204, contentType: "text/plain", body: "" }] },
  { name: "transcribe_soniox_upload_refused", provider: "soniox", modelId: "soniox/stt-async-v4", input: { audioBase64: wavBase64 }, replies: [jsonReply({ status_code: 401, error_type: "unauthorized", message: "Bad key." }, 401)] },
  { name: "transcribe_soniox_job_refused_only_deletes_the_file", provider: "soniox", modelId: "soniox/stt-async-v4", input: { audioBase64: wavBase64 }, replies: [jsonReply({ id: "file-1" }), jsonReply({ error_type: "invalid_request" }, 400), { status: 204, contentType: "text/plain", body: "" }] },
  { name: "transcribe_soniox_delete_failure_warns", provider: "soniox", modelId: "soniox/stt-async-v4", input: { audioBase64: wavBase64 }, replies: sonioxFlow({ id: "job-1", text: "Hi." }, { id: "job-1", status: "completed" }, [{ status: 500, contentType: "text/plain", body: "nope" }]) },
  { name: "transcribe_soniox_no_text", provider: "soniox", modelId: "soniox/stt-async-v4", input: { audioBase64: wavBase64 }, replies: sonioxFlow({ id: "job-1" }) },
].map((item) => ({ ...item, kind: "transcribe", options: {}, response: "", fixtureProvider: "media" }) as SdkParityCase);

export const sdkParityCases: SdkParityCase[] = [...compatibleCases, ...googleCases, ...gatewayCases, ...anthropicCases, ...openaiResponsesCases, ...chatgptCases, ...embedCases, ...speechCases, ...transcribeCases].map((item) => ({ ...item, fixtureProvider: item.fixtureProvider ?? "openai-compatible" }));
