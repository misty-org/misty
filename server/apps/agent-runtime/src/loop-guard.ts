import type { ModelMessage } from "ai";

// The loop guard (docs/plans/agent-harness-v2.md, change 1). Runs spent minutes repeating one
// call: the same page opened again and again, the same fetch of a page that didn't answer.
// browser-use breaks loops after three steps on one page without progress; here, the same call
// three times, or the same address opened three times, in the last dozen calls brings a note to
// change approach, once per pattern.

const WINDOW = 12;
const REPEATS = 3;
const marker = "Loop guard";

/** Tools that open an address; the address is what repeats. */
const opening = new Set(["browser_navigate", "screen_open", "web_fetch", "browser_tab_open"]);

interface Call {
  name: string;
  input: unknown;
}

function recentCalls(messages: ModelMessage[]): Call[] {
  const calls: Call[] = [];
  for (let index = messages.length - 1; index >= 0 && calls.length < WINDOW; index--) {
    const message = messages[index]!;
    if (message.role !== "assistant" || typeof message.content === "string") continue;
    for (const part of [...message.content].reverse()) {
      if (part.type === "tool-call" && calls.length < WINDOW) calls.push({ name: part.toolName, input: part.input });
    }
  }
  return calls;
}

function address(input: unknown): string {
  const url = (input as { url?: unknown } | undefined)?.url;
  if (typeof url !== "string") return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** The note for a loop the run is in, once per pattern, or undefined. */
export function loopNote(messages: ModelMessage[]): string | undefined {
  const counts = new Map<string, { count: number; label: string }>();
  for (const call of recentCalls(messages)) {
    const url = opening.has(call.name) ? address(call.input) : "";
    const key = url ? `open:${url}` : `${call.name}:${JSON.stringify(call.input ?? {})}`;
    const label = url ? `opened ${url}` : `called ${call.name} with the same input`;
    const entry = counts.get(key) ?? { count: 0, label };
    entry.count++;
    counts.set(key, entry);
  }
  for (const [key, { count, label }] of counts) {
    if (count < REPEATS) continue;
    const tag = `${marker} [${key.slice(0, 160)}]`;
    const said = messages.some(
      (message) => message.role === "user" && typeof message.content === "string" && message.content.startsWith(tag),
    );
    if (said) continue;
    return `${tag}: you have ${label} ${count} times in your last ${WINDOW} steps without moving on. Repeating it won't change the result. Change approach: use the page itself (click through, search on the site, apply its filters), try another source, or record what you have and move to the next part.`;
  }
  return undefined;
}
