/**
 * The composer's menus, opened by what is typed just before the caret: `@` mentions a file or
 * folder in the chat's linked folder, `/` runs a command (only at the start of a line), `$` uses a
 * skill, `!` inserts a saved prompt and `#` brings in a persona from the bundled catalog (`!` and
 * `#` after a space or at the start, so "Hello!" stays text). Pure helpers, so the rules are
 * tested apart from the menu.
 */

export type TriggerKind = "file" | "command" | "skill" | "prompt" | "persona";

export interface Trigger {
  kind: TriggerKind;
  /** What was typed after the trigger character. */
  query: string;
  /** Where the trigger character sits in the text. */
  start: number;
  /** The caret, where the typed query ends. */
  end: number;
}

const kinds: Record<string, TriggerKind> = {
  "@": "file",
  "/": "command",
  $: "skill",
  "!": "prompt",
  // A persona from the bundled catalog (`agents/personas`).
  "#": "persona",
};

/** The open trigger at the caret, if any. */
export function triggerAt(text: string, caret: number): Trigger | undefined {
  const before = text.slice(0, caret);
  const match = /(^|\s)([@/$!#])([^\s@/$!#]*(?:\/[^\s]*)*)$/.exec(before);
  if (!match) return undefined;
  const character = match[2];
  const start = before.length - match[3].length - 1;
  // A command starts its line; a slash anywhere else is a path or a fraction.
  if (character === "/") {
    const lineStart = before.lastIndexOf("\n", start - 1) + 1;
    if (before.slice(lineStart, start).trim()) return undefined;
  }
  // A file query may hold slashes (`@src/app`); a command, skill or prompt name may not.
  if (character !== "@" && match[3].includes("/")) return undefined;
  return { kind: kinds[character], query: match[3], start, end: caret };
}

/** The text with the trigger replaced by `insert`, and where the caret goes after it. */
export function applyTrigger(text: string, trigger: Trigger, insert: string) {
  const next = text.slice(0, trigger.start) + insert + text.slice(trigger.end);
  return { text: next, caret: trigger.start + insert.length };
}

/** Items whose name contains every typed word, names that start with the query first. */
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

/** A path as a mention the engines read: quoted when it holds spaces. */
export const mentionOf = (relative: string) =>
  /\s/.test(relative) ? `@"${relative}" ` : `@${relative} `;
