import { create } from "zustand";
import type { StudioState } from "./use_studio_agents";

export interface TeammateAgent {
  key: string;
  userId: string;
  agentId: string;
  name: string;
  owner: string;
  ownerPicture?: string;
  state: StudioState;
  doing: string;
  files: string[];
}

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

export function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export const useTeammateAgents = create<{
  agents: TeammateAgent[];
  show(agents: TeammateAgent[]): void;
}>((set) => ({
  agents: [],
  show: (agents) => set({ agents }),
}));

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
