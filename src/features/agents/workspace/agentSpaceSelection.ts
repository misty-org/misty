import type { Space } from "@/api/spaces/dto/interfaces/types";

/** Capture only the active, accessible Space. Global Ask must never guess a Space. */
export function resolveAgentSpaceId(spaces: Space[], activeScopeKey: string): string {
  const scopedId = activeScopeKey.startsWith("space:") ? activeScopeKey.slice("space:".length) : "";
  return spaces.find((space) => space.id === scopedId)?.id ?? "";
}

export function resolveMentionedAgentSpaceId(spaces: Space[], prompt: string): string {
  const normalized = normalizeSpaceReference(prompt);
  const matches = spaces.filter((space) => {
    const name = normalizeSpaceReference(space.name);
    if (!name) return false;
    // A coincidental word in the request is not a change of Space.
    return ` ${normalized} `.includes(` ${name} space `) ||
      ` ${normalized} `.includes(` space ${name} `) ||
      ["work in", "switch to", "use"].some((verb) => ` ${normalized} `.includes(` ${verb} ${name} `));
  });
  if (matches.length > 1) throw new Error("Choose one Space for this request.");
  if (!matches.length && /\b(?:work in|switch to|use) (?:the )?.+? space\b/.test(normalized)) {
    throw new Error("That Space is unavailable. Choose a Space you can access.");
  }
  return matches[0]?.id ?? "";
}

function normalizeSpaceReference(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
