import { create } from "zustand";
import type { StudioState } from "./useStudioAgents";

/** Another member's agent in the Space this window shows, as their computer last reported it. */
export interface TeammateAgent {
  /** Unique across members: the same agent id can exist on two people's computers. */
  key: string;
  name: string;
  /** The person it belongs to. An agent's name is free text, so whose it is always shows. */
  owner: string;
  /** The person's own profile picture, when they have one (an object URL). */
  ownerPicture?: string;
  state: StudioState;
  /** What it is doing, in a few plain words; empty while resting. */
  doing: string;
  /** The files it is changing, relative to the Space's linked folder: its claim. */
  files: string[];
}

/** For each of the person's own files, the teammates' agents that claim it too. Only a warning:
 * nothing stops two agents from working on one file. */
export function claimedByOthers(
  files: readonly string[],
  teammates: readonly TeammateAgent[],
): { file: string; by: TeammateAgent }[] {
  return files.flatMap((file) =>
    teammates
      .filter((mate) => mate.state !== "resting" && mate.files.includes(file))
      .map((by) => ({ file, by })),
  );
}

/** A file's last part, for a card with little room. */
export function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
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

/**
 * What the agent is told before a turn in a shared Space: the files teammates' agents are changing
 * right now, so it can steer around them. Empty when nobody claims anything. The paths come from
 * run events, never from a model, and the note is only advice: nothing is blocked.
 */
export function teammateClaimsNote(
  teammates: readonly TeammateAgent[] = useTeammateAgents.getState().agents,
): string {
  const lines = teammates
    .filter((mate) => mate.state !== "resting" && mate.files.length)
    .map((mate) => `- ${mate.owner}'s agent ${mate.name}: ${mate.files.join(", ")}`);
  if (!lines.length) return "";
  return [
    "Other members' agents in this Space are changing these files now (paths from the linked folder).",
    "Avoid editing them unless the task needs it; if it does, say so in your answer.",
    ...lines,
  ].join("\n");
}
