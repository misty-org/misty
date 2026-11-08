import type { AiInvocationEvent } from "../../runs/invocations/invocationTypes";
import { publishLocalRunEvent } from "../../runs/local-run/localRunEvents";
import { LocalToolRejected, type LocalToolRequest } from "../host";
import { RunStateError } from "./documents";
import { runContext, type RunContextOfChat as RunContext } from "../runContexts";
import { matchesSchema, type Schema } from "./schemas";

/** The shared steps of a run state tool: read the call, find its chat, say what happened. */

type WithoutId<Event> = Event extends { id: string } ? Omit<Event, "id"> : never;
type EventBody = WithoutId<AiInvocationEvent>;

/** Tells whoever follows the run, and a sub-agent's parent too. */
export function showEvent(runId: string, context: RunContext, event: EventBody) {
  for (const target of [runId, ...(context.parentRunId ? [context.parentRunId] : [])])
    publishLocalRunEvent(target, { id: crypto.randomUUID(), ...event } as AiInvocationEvent);
}

export function checkedInput<T>(request: LocalToolRequest, schema: Schema): T {
  if (!matchesSchema(schema, request.input))
    throw new LocalToolRejected(
      "invalid_arguments",
      "The arguments do not match this tool's input schema.",
    );
  return request.input as T;
}

export async function contextOf(runId: string): Promise<RunContext> {
  const context = await runContext(runId);
  if (!context)
    throw new LocalToolRejected("run_unknown", "Misty can't tell which chat this run belongs to.");
  return context;
}

/** A chat's own tool: a run outside any chat has nowhere to keep this. */
export function chatOf(context: RunContext, refusal: string): string {
  if (!context.conversationId) throw new LocalToolRejected("invalid_request", refusal);
  return context.conversationId;
}

/** Runs a change, turning a refused one into words the model can correct its call from. */
export async function correctable<R>(
  work: () => Promise<R>,
  words: { invalid?: string; conflict?: string },
): Promise<R> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof RunStateError)) throw error;
    const known = error.reason === "conflict" ? words.conflict : words.invalid;
    throw new LocalToolRejected(
      "invalid_request",
      known ?? (error.message || "The tool arguments are invalid."),
    );
  }
}
