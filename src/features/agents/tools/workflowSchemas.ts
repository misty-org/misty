import type { Schema } from "./run-state/schemas";

/**
 * What each workflow tool accepts, as the server's registry checked it before a call reached its
 * handler (`agent_method_tools.go`, `agent_schedule_tools.go`). A call that fails here had no effect.
 */

const text = (maxLength: number, minLength = 0): Schema => ({
  type: "string",
  minLength,
  maxLength,
});
const clock: Schema = text(5, 5);
const date: Schema = text(10, 10);
const integers = (minimum: number, maximum: number): Schema => ({
  type: "array",
  maxItems: 35,
  items: { type: "integer", minimum, maximum },
});
const reference = text(200, 1);
/** Values by name, checked apart because any key may be in the map; rendering checks each value. */
export const validInputs = (input: unknown) =>
  Boolean(input) && typeof input === "object" && !Array.isArray(input);

export const validKey = (key: string) => /^[a-z][a-z0-9_]{0,39}$/.test(key);

export const workflowListSchema: Schema = { type: "object", properties: {} };

export const workflowFindSchema: Schema = {
  type: "object",
  required: ["request"],
  properties: { request: text(1000, 1) },
};

export const workflowLearnSchema: Schema = {
  type: "object",
  required: ["method", "steps"],
  properties: { method: reference, steps: text(4000, 1) },
};

export const saveWorkflowSchema: Schema = {
  type: "object",
  required: ["title", "instructions"],
  properties: {
    id: text(200),
    title: text(120, 1),
    description: text(1000),
    instructions: text(6000, 1),
    inputs: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        required: ["key", "label", "type"],
        properties: {
          key: text(40, 1),
          label: text(80, 1),
          type: { type: "string", enum: ["text", "choice", "number", "boolean"] },
          required: { type: "boolean" },
          options: { type: "array", maxItems: 20, items: text(80) },
        },
      },
    },
  },
};

const rule: Schema = {
  type: "object",
  required: ["frequency"],
  properties: {
    frequency: {
      type: "string",
      enum: ["once", "hourly", "daily", "weekly", "monthly", "yearly"],
    },
    interval: { type: "integer", minimum: 1, maximum: 365 },
    dates: { type: "array", maxItems: 100, items: date },
    times: { type: "array", maxItems: 24, items: clock },
    minute: { type: "integer", minimum: 0, maximum: 59 },
    from: clock,
    until: clock,
    weekdays: integers(0, 6),
    month_days: integers(-1, 31),
    nth_weekdays: {
      type: "array",
      maxItems: 35,
      items: {
        type: "object",
        required: ["nth", "weekday"],
        properties: {
          nth: { type: "integer", minimum: -1, maximum: 5 },
          weekday: { type: "integer", minimum: 0, maximum: 6 },
        },
      },
    },
    months: integers(1, 12),
    start_date: date,
    end_date: date,
  },
};

export const workflowUnscheduleSchema: Schema = {
  type: "object",
  required: ["workflow_id"],
  properties: { workflow_id: reference },
};

/** These two also take an `inputs` map. */
export const workflowUseSchema: Schema = {
  type: "object",
  required: ["method"],
  properties: { method: reference },
};

export const scheduleWorkflowSchema: Schema = {
  type: "object",
  required: ["workflow_id", "timezone", "rules"],
  properties: {
    workflow_id: reference,
    timezone: text(64, 1),
    rules: { type: "array", minItems: 1, maxItems: 20, items: rule },
    skip_dates: { type: "array", maxItems: 366, items: date },
    enabled: { type: "boolean" },
  },
};
