import type { CallAgentState } from "./callAgents";

/**
 * What travels about agents on a call's data channel, encrypted with the call's key
 * (`callAgents.ts`): who is in and what each is doing. Nothing a model wrote goes here.
 */

/** The data channel topic everything about agents travels on. */
export const topic = "misty.agents";

export type Message =
  { t: "here"; id: string; name: string; state: CallAgentState } | { t: "left"; id: string };

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();
const states: CallAgentState[] = ["listening", "thinking", "speaking", "working"];

export function readMessage(value: unknown): Message | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  const id = typeof m.id === "string" ? m.id.slice(0, 120) : "";
  if (!id) return null;
  switch (m.t) {
    case "here":
      return typeof m.name === "string" && states.includes(m.state as CallAgentState)
        ? { t: "here", id, name: m.name.slice(0, 80), state: m.state as CallAgentState }
        : null;
    case "left":
      return { t: "left", id };
    default:
      return null;
  }
}
