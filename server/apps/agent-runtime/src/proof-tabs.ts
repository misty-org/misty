import type { ModelMessage } from "ai";

// Proof tabs (docs/plans/agent-harness-v2.md, change 2). Odysseys asks for pages "kept open"
// as proof in most of its tasks, and those items failed most often: the agent read the page with
// a fetch, closed the tab, or left it on a generic page or behind a dialog. When the request asks
// for pages left open, the first finish goes back once, unless the agent has just listed its
// tabs, to check each one against the request.

const keptOpen =
  /\b(keep|kept|leave|left|stay|remain)\b[^.]{0,80}\b(open|tabs?)\b|\b(in|on) (its|their|a|separate|different) (own )?tabs?\b|\bvisual proof\b|\bopen (in|as) (separate|different|new) tabs?\b/i;

/** Whether the person's request asks for pages left open. */
export function asksForOpenPages(request: string): boolean {
  return keptOpen.test(request);
}

/** Whether one of the last `within` tool calls was `tool`. */
function calledRecently(messages: ModelMessage[], tool: string, within = 4): boolean {
  let seen = 0;
  for (let index = messages.length - 1; index >= 0 && seen < within; index--) {
    const message = messages[index]!;
    if (message.role !== "assistant" || typeof message.content === "string") continue;
    for (const part of [...message.content].reverse()) {
      if (part.type !== "tool-call") continue;
      if (part.toolName === tool) return true;
      if (++seen >= within) break;
    }
  }
  return false;
}

/** The reason to send a finish back to check its tabs, or undefined. */
export function proofTabsRefusal(request: string, messages: ModelMessage[], tabList: string): string | undefined {
  if (!asksForOpenPages(request) || calledRecently(messages, tabList)) return undefined;
  return (
    `The person asked for pages to be left open, and those tabs are part of the answer. Before finishing, call ${tabList} ` +
    "and check each page the request names against your tabs: it is open in its own tab, on the right page (the item, not a search " +
    "or home page), in the state asked for (the search run, the option or size chosen, scrolled to the evidence) and not covered by " +
    "a dialog or banner. Open or fix any that are missing, then call agent_finish again."
  );
}
