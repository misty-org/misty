/**
 * What each run state tool accepts, as the server's tool registry checked it before a call reached its
 * handler (`ai_collaboration_tools.go`, `ai_checklist_tools.go`, `agent_notebook_tools.go`). A call that
 * fails here had no effect.
 */
export interface Schema {
  type: "object" | "array" | "string" | "boolean" | "integer";
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

export function matchesSchema(schema: Schema, value: unknown): boolean {
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") return false;
      const length = [...value].length;
      return (
        length >= (schema.minLength ?? 0) &&
        length <= (schema.maxLength ?? Infinity) &&
        (!schema.enum || schema.enum.includes(value))
      );
    }
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return (
        Number.isInteger(value) &&
        (value as number) >= (schema.minimum ?? -Infinity) &&
        (value as number) <= (schema.maximum ?? Infinity)
      );
    case "array":
      return (
        Array.isArray(value) &&
        value.length >= (schema.minItems ?? 0) &&
        value.length <= (schema.maxItems ?? Infinity) &&
        value.every((item) => !schema.items || matchesSchema(schema.items, item))
      );
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      const properties = schema.properties ?? {};
      return (
        (schema.required ?? []).every((name) => name in record) &&
        Object.entries(record).every(
          ([name, item]) => properties[name] && matchesSchema(properties[name], item),
        )
      );
    }
  }
}

const text = (maxLength: number, minLength = 0): Schema => ({
  type: "string",
  minLength,
  maxLength,
});
const list = (items: Schema, maxItems: number, minItems = 0): Schema => ({
  type: "array",
  items,
  minItems,
  maxItems,
});
const statuses = ["pending", "in_progress", "done", "skipped", "blocked"];
const status: Schema = { type: "string", enum: statuses };

export const askUserSchema: Schema = {
  type: "object",
  required: ["questions"],
  properties: {
    questions: list(
      {
        type: "object",
        required: ["header", "question", "options"],
        properties: {
          header: text(24, 1),
          question: text(500, 1),
          multiSelect: { type: "boolean" },
          options: list(
            {
              type: "object",
              required: ["label"],
              properties: { label: text(80, 1), description: text(300) },
            },
            4,
            2,
          ),
        },
      },
      4,
      1,
    ),
  },
};

export const proposePlanSchema: Schema = {
  type: "object",
  required: ["title", "summary", "steps"],
  properties: {
    title: text(160, 1),
    summary: text(1200),
    steps: list(
      {
        type: "object",
        required: ["title", "risk"],
        properties: {
          id: text(40),
          title: text(120, 1),
          detail: text(4000),
          tools: list(text(80), 8),
          risk: { type: "string", enum: ["read", "write", "draft", "consequential", "dangerous"] },
        },
      },
      12,
      1,
    ),
    assumptions: list(text(400), 10),
    successCriteria: list(text(400), 10),
  },
};

export const updatePlanSchema: Schema = {
  type: "object",
  required: ["steps"],
  properties: {
    steps: list(
      {
        type: "object",
        required: ["id", "status"],
        properties: { id: text(40), status, note: text(500) },
      },
      12,
      1,
    ),
  },
};

export const updateGoalSchema: Schema = {
  type: "object",
  required: ["status", "summary"],
  properties: {
    status: { type: "string", enum: ["in_progress", "achieved", "unmet"] },
    summary: text(2000, 1),
    evidence: list(
      {
        type: "object",
        required: ["criterion", "proof"],
        properties: { criterion: text(400, 1), proof: text(1000, 1) },
      },
      10,
    ),
    next_steps: list(text(400), 10),
  },
};

export const checklistSchema: Schema = {
  type: "object",
  required: ["items"],
  properties: {
    items: list(
      {
        type: "object",
        required: ["id", "status"],
        properties: {
          id: text(40, 1),
          title: text(160),
          status,
          note: text(500),
          delegated: { type: "boolean" },
        },
      },
      20,
      1,
    ),
    replace: { type: "boolean" },
    minutes: { type: "integer", minimum: 1, maximum: 240 },
  },
};

export const notebookReadSchema: Schema = { type: "object", properties: {} };

export const notebookWriteSchema: Schema = {
  type: "object",
  required: ["section", "content"],
  properties: {
    section: { type: "string", enum: ["plan", "findings"] },
    content: text(20000, 1),
    mode: { type: "string", enum: ["replace", "append"] },
  },
};
