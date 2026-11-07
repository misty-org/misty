import { ApiRequestError } from "@/api/client/errors";
import type {
  AgentMethod,
  AgentMethodInputs,
  SaveAgentMethod,
  SaveWorkflowSchedule,
} from "@/api/ai/agent-methods";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { RunStateError } from "../localTools/runState/documents";
import { allMethods, methodAtVersion, methodsOf, publicMethod, saveMethod } from "./localMethods";
import { listSchedules, type LocalSchedule } from "./localSchedules";
import { removeSchedule, saveSchedule, upcomingSchedules } from "./scheduleEdits";
import { renderMethod } from "./methodDefinition";

/**
 * What `agentMethodsApi` answers once workflows live on this computer. Refusals read as the server's
 * did, because the page tells a stale edit from a bad one by its status.
 */

const account = () => useMistyStore.getState().accountId;

const messages = {
  invalid: "Check the method instructions, execution location and required input values.",
  conflict: "The method changed or reached its limit. Refresh before retrying.",
  not_found: "This method or agent is no longer available.",
};
const statuses = { invalid: 400, conflict: 409, not_found: 404 };

function refusal(error: unknown): unknown {
  if (!(error instanceof RunStateError)) return error;
  return new ApiRequestError(
    messages[error.reason],
    statuses[error.reason],
    `method_${error.reason}`,
  );
}

function scheduleRefusal(error: unknown): unknown {
  if (error instanceof RunStateError && error.reason === "invalid")
    return new ApiRequestError(
      "Check the schedule: each rule needs its days and times, and every required input needs a value.",
      400,
      "invalid_schedule",
    );
  if (error instanceof RunStateError && error.reason === "conflict")
    return new ApiRequestError(
      "You have reached the limit of 50 scheduled workflows.",
      409,
      "schedule_limit",
    );
  return refusal(error);
}

/** The Workflows page shows the personal Space's workflows, as it does from the server. */
export function withSchedules(methods: AgentMethod[], schedules: LocalSchedule[]): AgentMethod[] {
  return methods.map((method) => {
    const schedule = schedules.find((item) => item.method_id === method.id);
    return schedule ? { ...method, schedule } : method;
  });
}

export const localAgentMethods = {
  list: async (agentId: string) => {
    const [methods, schedules] = await Promise.all([
      methodsOf(account(), "", agentId),
      listSchedules(account()),
    ]);
    return { methods: withSchedules(methods.map(publicMethod), schedules) };
  },
  save: async (input: SaveAgentMethod) => {
    try {
      return { method: publicMethod(await saveMethod(account(), input)) };
    } catch (error) {
      throw refusal(error);
    }
  },
  saveSchedule: async (methodId: string, schedule: SaveWorkflowSchedule) => {
    try {
      return { schedule: await saveSchedule(account(), methodId, schedule, Date.now()) };
    } catch (error) {
      throw scheduleRefusal(error);
    }
  },
  removeSchedule: async (methodId: string) => {
    try {
      await removeSchedule(account(), methodId);
    } catch (error) {
      throw refusal(error);
    }
  },
  upcoming: async () => ({ runs: await upcomingSchedules(account()) }),
  instantiate: async (versionId: string, inputs: AgentMethodInputs) => {
    const method = methodAtVersion(await allMethods(account()), versionId);
    if (!method) throw refusal(new RunStateError("not_found"));
    const prompt = renderMethod(method.definition, inputs);
    if (prompt === null) throw refusal(new RunStateError("invalid"));
    return { prompt, method };
  },
};
