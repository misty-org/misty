import type { AgentMethodInput, ScheduleRule } from "../api/agent-methods";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { preferredDefaultSpace, spacesSnapshot } from "@/features/app-windows";
import {
  addLesson,
  latestLesson,
  methodById,
  methodsOf,
  saveMethod,
  type LocalMethod,
} from "../workflows/localMethods";
import { listSchedules } from "../workflows/localSchedules";
import { removeSchedule, saveSchedule } from "../workflows/scheduleEdits";
import { renderMethod, validMethodDefinition } from "../workflows/methodDefinition";
import { findByMeaning, matchWorkflows } from "../workflows/workflowFind";
import { LocalToolRejected, type LocalToolHandler, type LocalToolRequest } from "./host";
import { loadRunEntry } from "./runContexts";
import { RunStateError } from "./run-state/documents";
import type { Schema } from "./run-state/schemas";
import { checkedInput } from "./run-state/toolSupport";
import {
  saveWorkflowSchema,
  scheduleWorkflowSchema,
  validInputs,
  validKey,
  workflowFindSchema,
  workflowLearnSchema,
  workflowListSchema,
  workflowUnscheduleSchema,
  workflowUseSchema,
} from "./workflowSchemas";

/**
 * Saved workflows on this computer. The agent reads a
 * workflow's instructions and follows them in its current run, so a workflow never starts a second
 * run or grants a tool. A run sees and saves only its own Space's workflows. Answers and refusals
 * match the server's (`agent_method_tools.go`, `agent_schedule_tools.go`) word for word.
 */

interface WorkflowScope {
  account: string;
  agentId: string;
  /** Empty is the personal Space. */
  spaceId: string;
}

const invalidSchedule =
  "give a workflow_id from memory_workflow_list, an IANA timezone and rules: times as HH:MM " +
  "for every frequency except hourly, dates for once, weekdays for weekly, month_days or nth_weekdays " +
  "for monthly and yearly, months for yearly; and a value for every required workflow input";

const refuse = (message: string) => new LocalToolRejected("invalid_request", message);

const badArguments = () =>
  new LocalToolRejected(
    "invalid_arguments",
    "The arguments do not match this tool's input schema.",
  );

/** Checks everything but the `inputs` map, whose keys are the workflow's own. */
function checkedWithInputs<T>(request: LocalToolRequest, schema: Schema): T {
  const { inputs, ...rest } = request.input;
  if (inputs !== undefined && !validInputs(inputs)) throw badArguments();
  checkedInput({ ...request, input: rest }, schema);
  return request.input as T;
}

/** The default Space's id is what a request names, but saved workflows file it as the personal one. */
function normalizedSpace(spaceId: string): string {
  if (!spaceId) return "";
  return preferredDefaultSpace(spacesSnapshot().spaces)?.id === spaceId ? "" : spaceId;
}

async function scopeOf(request: LocalToolRequest): Promise<WorkflowScope> {
  const entry = await loadRunEntry(request.runId);
  if (!entry)
    throw new LocalToolRejected("run_unknown", "Misty can't tell which agent this run belongs to.");
  return {
    account: entry.account || useMistyStore.getState().accountId,
    agentId: entry.agentId,
    spaceId: normalizedSpace(entry.spaceId),
  };
}

/** The run's agent's enabled workflows in the run's Space. */
async function workflowsFor(scope: WorkflowScope): Promise<LocalMethod[]> {
  if (!scope.agentId) return [];
  const methods = await methodsOf(scope.account, scope.spaceId, scope.agentId);
  return methods.filter((method) => method.enabled && method.kind === "workflow");
}

function matching(methods: LocalMethod[], reference: string): LocalMethod | undefined {
  const wanted = reference.trim();
  return methods.find(
    (method) =>
      method.id === wanted || method.definition.title.trim().toLowerCase() === wanted.toLowerCase(),
  );
}

const listTool: LocalToolHandler = async (request) => {
  checkedInput(request, workflowListSchema);
  const methods = await workflowsFor(await scopeOf(request));
  return {
    methods: methods.map(({ id, definition }) => ({
      id,
      title: definition.title,
      description: definition.description,
      inputs: definition.inputs,
      where: definition.target,
    })),
  };
};

const findTool: LocalToolHandler = async (request) => {
  const input = checkedInput<{ request: string }>(request, workflowFindSchema);
  if (!input.request.trim())
    throw new LocalToolRejected("invalid_arguments", "The request is empty.");
  const scope = await scopeOf(request);
  const methods = await workflowsFor(scope);
  const found = await findByMeaning(scope.account, methods, input.request, 3, request.signal);
  // Vectors may be missing, or this computer may have no embedding model.
  return { workflows: found.length ? found : matchWorkflows(methods, input.request, 3) };
};

const useTool: LocalToolHandler = async (request) => {
  const input = checkedWithInputs<{ method: string; inputs?: Record<string, unknown> }>(
    request,
    workflowUseSchema,
  );
  const scope = await scopeOf(request);
  const method = matching(await workflowsFor(scope), input.method);
  if (!method) throw refuse(`no enabled method ${input.method.trim()}; call memory_workflow_list`);
  const instructions = renderMethod(method.definition, input.inputs);
  if (instructions === null)
    throw refuse(
      `those inputs do not fit ${method.definition.title}; check its inputs in memory_workflow_list`,
    );
  const lesson = latestLesson(method);
  return {
    method: method.definition.title,
    instructions,
    ...(lesson
      ? {
          learned_steps: lesson.steps,
          learned_version: lesson.version,
          learned_note:
            "Steps that worked on earlier runs. Follow them where they still fit; if one no longer works, " +
            "adapt, and save what worked with memory_workflow_learn.",
        }
      : {}),
    ...(method.definition.target !== "cloud"
      ? {
          note: "This method was saved to run in a Misty browser window. Do what you can with your tools, or tell the user to start it from the Agents page.",
        }
      : {}),
  };
};

const saveTool: LocalToolHandler = async (request) => {
  const input = checkedInput<{
    id?: string;
    title: string;
    description?: string;
    instructions: string;
    inputs?: AgentMethodInput[];
  }>(request, saveWorkflowSchema);
  if ((input.inputs ?? []).some((field) => !validKey(field.key))) throw badArguments();
  const scope = await scopeOf(request);
  if (!scope.agentId) throw refuse("memory_workflow_save is available only to agents");
  const id = input.id?.trim();
  const existing = id
    ? (await methodsOf(scope.account, scope.spaceId, scope.agentId)).find((item) => item.id === id)
    : undefined;
  if (id && !existing) throw refuse(`no method ${id} for this agent; call memory_workflow_list`);
  const definition = {
    title: input.title,
    description: input.description ?? "",
    instructions: input.instructions,
    inputs: (input.inputs ?? []).map((field) => ({ ...field, required: field.required === true })),
    target: existing?.definition.target ?? ("cloud" as const),
    required_tools: [],
  };
  if (!validMethodDefinition(definition))
    throw refuse(
      "a method needs a title under 120 characters, instructions under 6000 and at most 12 inputs",
    );
  try {
    const saved = await saveMethod(scope.account, {
      id,
      space_id: scope.spaceId,
      agent_id: scope.agentId,
      kind: "workflow",
      enabled: existing?.enabled ?? true,
      expected_version: existing?.version,
      definition,
    });
    return { method: { id: saved.id, title: saved.definition.title, version: saved.version } };
  } catch (error) {
    if (!(error instanceof RunStateError)) throw error;
    throw refuse(
      "the method could not be saved; it may have changed, so read it again with memory_workflow_list",
    );
  }
};

const learnTool: LocalToolHandler = async (request) => {
  const input = checkedInput<{ method: string; steps: string }>(request, workflowLearnSchema);
  const scope = await scopeOf(request);
  const method = matching(await workflowsFor(scope), input.method);
  if (!method) throw refuse(`no enabled workflow ${input.method}; call memory_workflow_list`);
  try {
    const lesson = await addLesson(scope.account, method.id, input.steps, request.runId);
    return { workflow: method.definition.title, version: lesson.version };
  } catch (error) {
    if (!(error instanceof RunStateError)) throw error;
    throw refuse("the steps need to be between 1 and 4000 characters");
  }
};

const scheduleTool: LocalToolHandler = async (request) => {
  const input = checkedWithInputs<{
    workflow_id: string;
    timezone: string;
    rules: ScheduleRule[];
    skip_dates?: string[];
    inputs?: Record<string, string | number | boolean>;
    enabled?: boolean;
  }>(request, scheduleWorkflowSchema);
  const scope = await scopeOf(request);
  // A run schedules only its own workflows, in its own Space.
  if (!(await workflowsFor(scope)).some((method) => method.id === input.workflow_id.trim()))
    throw refuse(invalidSchedule);
  try {
    const schedule = await saveSchedule(
      scope.account,
      input.workflow_id.trim(),
      {
        timezone: input.timezone,
        rules: input.rules,
        skip_dates: input.skip_dates ?? [],
        inputs: input.inputs,
        enabled: input.enabled,
      },
      Date.now(),
    );
    const { lease_until: _lease, window_id: _window, ...shown } = schedule;
    return { schedule: shown };
  } catch (error) {
    if (!(error instanceof RunStateError)) throw error;
    throw refuse(
      error.reason === "conflict"
        ? "this account already has the limit of 50 scheduled workflows"
        : invalidSchedule,
    );
  }
};

const unscheduleTool: LocalToolHandler = async (request) => {
  const input = checkedInput<{ workflow_id: string }>(request, workflowUnscheduleSchema);
  const id = input.workflow_id.trim();
  const scope = await scopeOf(request);
  const method = await methodById(scope.account, id);
  if (!method) throw refuse(`no workflow ${id}; call memory_workflow_list for ids`);
  const schedules = await listSchedules(scope.account);
  if (!schedules.some((schedule) => schedule.method_id === id))
    throw refuse(`workflow ${id} has no schedule`);
  await removeSchedule(scope.account, id);
  return { unscheduled: id, title: method.definition.title };
};

export const workflowTools: Record<string, LocalToolHandler> = {
  "memory.workflow.list": listTool,
  "memory.workflow.find": findTool,
  "memory.workflow.use": useTool,
  "memory.workflow.save": saveTool,
  "memory.workflow.learn": learnTool,
  "memory.workflow.schedule": scheduleTool,
  "memory.workflow.unschedule": unscheduleTool,
};
