import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runParityCase } from "./run-parity.cases.js";

/** One model call as the recorder keeps it. Key order is kept in the texts the fixture holds as text. */
export const calls: unknown[] = [];

function recorded(options: LanguageModelV4CallOptions) {
  const inputs = options.prompt.flatMap((message) => (message.role === "assistant" ? message.content.flatMap((part) => (part.type === "tool-call" ? [JSON.stringify(part.input)] : [])) : []));
  const schemas = (options.tools ?? []).map((tool) => (tool.type === "function" ? JSON.stringify(tool.inputSchema) : ""));
  return {
    prompt: options.prompt,
    tools: options.tools,
    toolChoice: options.toolChoice,
    maxOutputTokens: options.maxOutputTokens,
    reasoning: options.reasoning,
    providerOptions: options.providerOptions,
    inputs,
    schemas,
  };
}

export const model = new MockLanguageModelV4({
  provider: "misty.instance",
  modelId: runParityCase.modelId,
  doStream: async (options) => {
    const turn = runParityCase.turns[calls.length];
    if (!turn) throw new Error("the script ran out");
    calls.push(JSON.parse(JSON.stringify(recorded(options))));
    const chunks: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
    turn.parts.forEach((part, index) => {
      if (part.type === "text") chunks.push({ type: "text-start", id: `t${index}` }, { type: "text-delta", id: `t${index}`, delta: part.text }, { type: "text-end", id: `t${index}` });
      else chunks.push({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input, ...(part.providerMetadata ? { providerMetadata: part.providerMetadata as never } : {}) });
    });
    chunks.push({ type: "finish", finishReason: { unified: turn.finishReason as "stop", raw: undefined }, usage: { inputTokens: { total: turn.inputTokens, noCache: turn.inputTokens, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } });
    return { stream: simulateReadableStream({ chunks, initialDelayInMs: 0, chunkDelayInMs: 0 }) };
  },
});
