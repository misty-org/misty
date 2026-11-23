export type TriggerKind = "file" | "command" | "skill" | "prompt" | "persona";

export interface Trigger {
  kind: TriggerKind;
  query: string;
  start: number;
  end: number;
}

const kinds: Record<string, TriggerKind> = {
  "@": "file",
  "/": "command",
  $: "skill",
  "!": "prompt",
  "#": "persona",
};

export function triggerAt(text: string, caret: number): Trigger | undefined {
  const before = text.slice(0, caret);
  const match = /(^|\s)([@/$!#])([^\s@/$!#]*(?:\/[^\s]*)*)$/.exec(before);
  if (!match) return undefined;
  const character = match[2];
  const start = before.length - match[3].length - 1;
  if (character === "/") {
    const lineStart = before.lastIndexOf("\n", start - 1) + 1;
    if (before.slice(lineStart, start).trim()) return undefined;
  }
  if (character !== "@" && match[3].includes("/")) return undefined;
  return { kind: kinds[character], query: match[3], start, end: caret };
}

export function applyTrigger(text: string, trigger: Trigger, insert: string) {
  const next = text.slice(0, trigger.start) + insert + text.slice(trigger.end);
  return { text: next, caret: trigger.start + insert.length };
}

export function filterItems<T extends { name: string; description?: string }>(
  items: T[],
  query: string,
  limit = 30,
): T[] {
  const words = query
    .toLowerCase()
    .split(/[\s:]+/)
    .filter(Boolean);
  const matched = items.filter((item) => {
    const name = item.name.toLowerCase();
    return words.every((word) => name.includes(word));
  });
  const first = query.toLowerCase();
  matched.sort(
    (a, b) =>
      Number(!a.name.toLowerCase().startsWith(first)) -
        Number(!b.name.toLowerCase().startsWith(first)) || a.name.localeCompare(b.name),
  );
  return matched.slice(0, limit);
}

export const mentionOf = (relative: string) =>
  /\s/.test(relative) ? `@"${relative}" ` : `@${relative} `;
