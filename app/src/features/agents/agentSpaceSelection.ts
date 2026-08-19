import type { Space } from "@/api/spaces/dto/interfaces/types";

/**
 * Pick a Space where an agent can actually perform workspace actions.
 * Explicit/current Space context wins, otherwise prefer a normal Space over
 * the private Misty support Space, whose conversations are intentionally
 * isolated and do not expose shared workspace tools.
 */
export function resolveAgentSpaceId(spaces: Space[], activeScopeKey: string): string {
  const scopedId = activeScopeKey.startsWith("space:") ? activeScopeKey.slice("space:".length) : "";
  return (
    spaces.find((space) => space.id === scopedId)?.id ??
    spaces.find((space) => space.kind !== "misty")?.id ??
    spaces.find((space) => space.kind === "misty")?.id ??
    spaces[0]?.id ??
    ""
  );
}
