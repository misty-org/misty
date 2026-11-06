/**
 * A fixed scripted run: what the model answers each turn and what each tool returns. The recorder
 * writes it down with every model call the TypeScript loop makes, and
 * `src-tauri/crates/agent/src/runtime/run/parity_tests.rs` plays the same script against the Rust loop.
 */
export type ScriptPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: string; providerMetadata?: Record<string, unknown> };

export interface ScriptTurn {
  parts: ScriptPart[];
  finishReason: string;
  inputTokens: number;
}

const call = (toolCallId: string, toolName: string, input: string, providerMetadata?: Record<string, unknown>): ScriptPart => ({
  type: "tool-call", toolCallId, toolName, input, ...(providerMetadata ? { providerMetadata } : {}),
});

export const runParityCase = {
  modelId: "anthropic/claude-sonnet-5-5",
  reasoning: "medium",
  prompt: "Read my note about the launch and tell me the date.",
  system: "You are Misty. The current time is 2026-11-06T12:00:00Z.",
  turnLimit: 7,
  catalog: [
    { name: "note.read", description: "Read a note.", inputSchema: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", minLength: 2 }, why: { type: "string" } } }, readOnly: true, concurrent: true },
    { name: "note.create", description: "Create a note.", inputSchema: { type: "object", required: ["title"], properties: { title: { type: "string" } } }, readOnly: false, concurrent: false },
    { name: "browser.visual", description: "Look at the screen.", inputSchema: { type: "object", properties: {} }, readOnly: true, concurrent: false },
  ],
  /** What each catalog call returns, by call ID. A string is a rejection without effect. */
  toolOutputs: {
    "read-1": { z: 1, text: "The launch is on March 3.", a: [1, 2] },
    "visual-1": { documentId: "d-1", image: { dataUrl: "data:image/png;base64,AAAA", width: 1, height: 1 } },
    "create-1": "tool_rejected: That title is taken.",
    "create-2": { id: "note-9", ok: true },
  } as Record<string, unknown>,
  turns: [
    // Text beside calls: one valid, one with broken JSON, one for a tool that isn't offered, one that doesn't fit its schema.
    { parts: [
      { type: "text", text: "Let me look." },
      call("read-1", "note_read", '{ "why" : "date", "id" : "launch" }', { google: { thoughtSignature: "sig" }, openai: { itemId: "drop-me" } }),
      call("bad-json", "note_read", "{oops"),
      call("no-tool", "note_delete", '{"id":"x"}'),
      call("bad-schema", "note_read", '{"id":5}'),
    ], finishReason: "tool-calls", inputTokens: 1000 },
    // A screenshot comes back as an image, and a ledger row with no evidence is refused its done.
    { parts: [
      call("visual-1", "browser_visual", "{}"),
      call("ledger-1", "agent_ledger", '{"rows":[{"requirement":"Find the date","state":"done"}]}'),
    ], finishReason: "tool-calls", inputTokens: 1200 },
    // A write the server rejects without effect pauses the rest of the response.
    { parts: [
      call("create-1", "note_create", '{"title":"Launch"}'),
      call("create-skipped", "note_create", '{"title":"Launch again"}'),
    ], finishReason: "tool-calls", inputTokens: 1300 },
    // The corrected write goes through.
    { parts: [call("create-2", "note_create", '{"title":"Launch date"}')], finishReason: "tool-calls", inputTokens: 1400 },
    // Answering in plain text after work is verified and asked to confirm. A progress line goes back first.
    { parts: [{ type: "text", text: "Next: I'll write the answer." }], finishReason: "stop", inputTokens: 1500 },
    { parts: [{ type: "text", text: "The launch is on March 3." }], finishReason: "stop", inputTokens: 1600 },
    { parts: [call("finish-1", "agent_finish", '{"outcome":"completed","remaining":[]}')], finishReason: "tool-calls", inputTokens: 1700 },
  ] as ScriptTurn[],
};
