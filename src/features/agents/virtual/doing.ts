import type { MistyActivityEntry } from "../conversations/state/activity";

const toolWords: [prefix: string, words: string, code: string][] = [
  ["browser.", "On a web page", "browser"],
  ["web.", "Searching the web", "web"],
  ["shell", "Running a command", "shell"],
  ["Bash", "Running a command", "shell"],
  ["file.", "Working with files", "files"],
  ["folder.", "Working with files", "files"],
  ["edit", "Working with files", "files"],
  ["Edit", "Working with files", "files"],
  ["Write", "Working with files", "files"],
  ["Read", "Working with files", "files"],
  ["note.", "Writing in the Space", "space"],
  ["drawing.", "Drawing in the Space", "space"],
  ["thread.", "Posting in the Space", "space"],
  ["message.", "Posting in the Space", "space"],
  ["mcp__misty__", "Working in the Space", "space"],
  ["screen.", "Using the computer", "computer"],
  ["apps.", "Using a connected app", "app"],
  ["agent.", "Working with another agent", "agents"],
];

type Events = Pick<MistyActivityEntry, "events">;

/** A tool as a few plain words, and as a fixed code. */
export function wordsOf(tool: string): { words: string; code: string } {
  const known = toolWords.find(([prefix]) => tool.startsWith(prefix));
  return known ? { words: known[1], code: known[2] } : { words: "Working", code: "working" };
}

/** A run's latest tool as a few plain words, and as a fixed code. */
export function doingOf(entry: Events): { words: string; code: string } {
  for (let index = entry.events.length - 1; index >= 0; index -= 1) {
    const tool = entry.events[index]?.toolName ?? entry.events[index]?.tool_name;
    if (tool) return wordsOf(tool);
  }
  return { words: "Thinking", code: "thinking" };
}

/** The last few things a run did, newest first, in the same plain words. Doing the same kind of
 * thing several times in a row counts once. */
export function stepsOf(entry: Events, most = 4): string[] {
  const steps: string[] = [];
  for (let index = entry.events.length - 1; index >= 0 && steps.length < most; index -= 1) {
    const tool = entry.events[index]?.toolName ?? entry.events[index]?.tool_name;
    if (!tool) continue;
    const { words } = wordsOf(tool);
    if (steps[steps.length - 1] !== words) steps.push(words);
  }
  return steps;
}
