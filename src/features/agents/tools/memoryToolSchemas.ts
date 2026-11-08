import type { Schema } from "./run-state/schemas";

/**
 * What each memory tool accepts, as the server's tool registry checked it before a call reached its
 * handler (`recall_agent_tools.go`, `agent_memory_tools.go`). A call that fails here had no effect.
 */

const when: Schema = { type: "string", maxLength: 64 };
const site: Schema = { type: "string", maxLength: 255 };

export const prefListSchema: Schema = {
  type: "object",
  properties: { query: { type: "string", maxLength: 500 } },
};

export const prefUpdateSchema: Schema = {
  type: "object",
  required: ["memoryId", "content"],
  properties: {
    memoryId: { type: "string", maxLength: 200 },
    content: { type: "string", minLength: 1, maxLength: 1000 },
  },
};

export const prefRememberSchema: Schema = {
  type: "object",
  required: ["content", "kind", "scope"],
  properties: {
    content: { type: "string", minLength: 1, maxLength: 1000 },
    kind: { type: "string", enum: ["fact", "preference", "instruction"] },
    scope: { type: "string", enum: ["personal"] },
    reason: { type: "string", maxLength: 500 },
  },
};

export const prefForgetSchema: Schema = {
  type: "object",
  required: ["memoryId"],
  properties: { memoryId: { type: "string", minLength: 1, maxLength: 200 } },
};

export const historySearchSchema: Schema = {
  type: "object",
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 500 },
    limit: { type: "integer", minimum: 1, maximum: 20 },
  },
};

export const historyTimelineSchema: Schema = {
  type: "object",
  required: ["from"],
  properties: {
    from: when,
    to: when,
    site,
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
};

export const historyForgetSchema: Schema = {
  type: "object",
  properties: { site, from: when, to: when },
};

export const treeReadSchema: Schema = {
  type: "object",
  properties: {
    parent: { type: "string", maxLength: 300 },
    from: when,
    to: when,
    depth: { type: "integer", minimum: 1, maximum: 2 },
  },
};
