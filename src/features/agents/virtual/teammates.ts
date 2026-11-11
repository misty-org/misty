import { create } from "zustand";
import type { OfficeState } from "./useOfficeAgents";

/** Another member's agent in the Space this window shows, as their computer last reported it. */
export interface TeammateAgent {
  /** Unique across members: the same agent id can exist on two people's computers. */
  key: string;
  name: string;
  /** The person it belongs to. An agent's name is free text, so whose it is always shows. */
  owner: string;
  state: OfficeState;
  /** What it is doing, in a few plain words; empty while resting. */
  doing: string;
}

/**
 * The teammates' agents in view. Spaces fills this in from the Space's live channel; the room,
 * the home strip and the sidebar read it. They can be looked at, never asked: an agent takes
 * requests only from its own person.
 */
export const useTeammateAgents = create<{
  agents: TeammateAgent[];
  show(agents: TeammateAgent[]): void;
}>((set) => ({
  agents: [],
  show: (agents) => set({ agents }),
}));
