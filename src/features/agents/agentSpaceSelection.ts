import type { Space } from "@/api/spaces/dto/interfaces/types";

/**
 * Pick a Space where an agent can actually perform workspace actions.
 * Explicit/current Space context wins, followed by the account's default.
 */
export function resolveAgentSpaceId(spaces: Space[], activeScopeKey: string): string {
  const scopedId = activeScopeKey.startsWith("space:") ? activeScopeKey.slice("space:".length) : "";
  return (
    spaces.find((space) => space.id === scopedId)?.id ??
    spaces.find((space) => space.is_default)?.id ??
    spaces[0]?.id ??
    ""
  );
}

export function resolveMentionedAgentSpaceId(spaces: Space[], prompt: string): string {
  const normalized = normalizeSpaceReference(prompt);
  const matches = spaces.filter((space) => {
    const name = normalizeSpaceReference(space.name);
    if (!name) return false;
    return ` ${normalized} `.includes(` ${name} `) || ` ${normalized} `.includes(` ${name} space `);
  });
  return matches.length === 1 ? matches[0].id : "";
}

function normalizeSpaceReference(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
