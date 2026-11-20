import type { ConversationTool } from "./companionVoiceSocket";
import type { DisplayCapture } from "./protocol";

/**
 * What a spoken answer's tags ask for, and the notes a turn's prompt carries about the person's
 * agents, how they like answers and the window in front. The tags are never read aloud
 * (`replyTags`).
 */

/** What an answer's tags can do; the voice session supplies each. */
export interface AnswerActions {
  /** The ID of the task a tool started or acted on; for get_task_status, the status as JSON. */
  tool: (tool: ConversationTool, conversationId: string) => Promise<string | undefined>;
  /** Opens a web page the answer names ([OPEN:…]) in the person's browser. */
  openPage?: (url: string) => void;
  /** Opens one of Misty's settings pages the answer names ([SETTINGS:…]). */
  openSettingsPage?: (page: string) => void;
  /** Opens the chat the last hand-off went to ([CHAT]). */
  openChat?: () => void;
  /** Keeps how they want answers from now on ([REMEMBER:…]), or drops it all ([FORGET]). */
  remember?: (line: string) => void;
  forget?: () => void;
  /**
   * Does what was asked on their screen in front of them while saying each step ([DRIVE:…]),
   * so they learn the app as it's done. The task's id.
   */
  drive?: (
    request: string,
    conversationId: string,
    key: string,
    agent?: string,
  ) => Promise<string | undefined>;
}

/**
 * A task tag's request and the agent it names, if any: `[TASK: …]`, or `[TASK @Ada: …]` when the
 * person said who should do it.
 */
export function taskTag(
  tag: "TASK" | "DRIVE",
  text: string,
): { request: string; agent?: string } | undefined {
  const found = new RegExp(`\\[${tag}(?:\\s*@([^:\\]]+))?:\\s*([^\\]]+)\\]`).exec(text);
  const request = found?.[2]?.trim();
  if (!request) return undefined;
  const agent = found?.[1]?.trim();
  return agent ? { request, agent } : { request };
}

/**
 * How they asked to be answered, carried into every session so "simpler please" holds tomorrow
 * too, and how to change it.
 */
export function styleNote(style: string[]) {
  const kept = style.length
    ? `They asked you before to answer like this; keep to it: ${style.join("; ")}. `
    : "";
  return (
    kept +
    "When they say how they want answers from now on (simpler, shorter, more drawings, in " +
    "another language), reply with [REMEMBER: <that, in a few words>] and one short sentence. " +
    "When they ask you to go back to how you answered before, reply with [FORGET]."
  );
}

/**
 * The person's agents, for handing work to by name. Their names are built in code from the
 * person's own agents, never written by a model.
 */
export function agentsNote(agents: string[]) {
  if (!agents.length)
    return "They have no agents yet, so work can't be handed off; say they can make one.";
  return (
    `Their agents: ${agents.join(", ")}. When they say which one should do the work ("ask ` +
    `${agents[0]} to…"), write the task as [TASK @<that name>: …] (or [DRIVE @<that name>: …]). ` +
    "When they say work you just handed off should go to another of them instead " +
    `("no, ${agents[agents.length - 1]}"), reply with [REASSIGN: <that name>] and one short ` +
    "sentence saying who has it now. When they ask to see that work or the agent's chat, end " +
    "with [CHAT] to open it for them."
  );
}

/** Settings pages an answer may open, by the names it uses. */
const settingsPages: Record<string, string> = {
  voice: "voice",
  tutor: "agents-companion",
  shortcuts: "shortcuts",
  appearance: "appearance",
  engine: "models",
};

/** An engine's safety filter turned the request down: said plainly, with the idea offered instead. */
export const filtered = /safety|content (?:policy|filter)|usage polic|flagged|refus|harm/i;
export const filteredLine =
  "My engine's safety filter turned that one down. I can explain the ideas behind it instead, if that helps.";

/**
 * The document or page the window in front has open, so a question about all of it ("summarize
 * this PDF", "what does the rest of the article say") is answered from all of it, not the screen.
 */
export function openDocument(screens: DisplayCapture[]) {
  const window = screens.find((screen) => screen.document);
  if (!window?.document) return "";
  const app = window.app ? ` (${window.app})` : "";
  return (
    `The window in front${app} has ${window.document} open. When they ask about more than ` +
    "what's on screen (the whole document, the rest of the page), read it with your own tools."
  );
}

/** Does what the answer's tags ask: hand work on or move it, open a page, a chat or a setting. */
export async function actOnTags(
  text: string,
  id: string,
  conversationId: string,
  actions: AnswerActions,
) {
  const asked = taskTag("TASK", text);
  if (asked)
    await actions.tool(
      {
        callId: id,
        name: "start_task",
        instruction: asked.request,
        agent: asked.agent,
        key: `voice-task:${id}`,
        invocationId: "",
      },
      conversationId,
    );
  const drive = taskTag("DRIVE", text);
  if (drive && actions.drive)
    await actions.drive(drive.request, conversationId, `voice-drive:${id}`, drive.agent);
  // "No, Ada": the work just handed off goes to another agent.
  const moved = /\[REASSIGN:\s*([^\]]+)\]/.exec(text)?.[1]?.trim();
  if (moved && !asked && !drive)
    await actions.tool(
      {
        callId: id,
        name: "reassign_task",
        instruction: moved,
        agent: moved,
        key: `voice-reassign:${id}`,
        invocationId: "",
      },
      conversationId,
    );
  const page = /\[OPEN:\s*(https?:\/\/[^\]\s]+)\s*\]/i.exec(text)?.[1];
  if (page) actions.openPage?.(page);
  if (/\[CHAT\]/i.test(text)) actions.openChat?.();
  const kept = /\[REMEMBER:\s*([^\]]+)\]/i.exec(text)?.[1]?.trim();
  if (kept) actions.remember?.(kept);
  if (/\[FORGET\]/i.test(text)) actions.forget?.();
  const settings = /\[SETTINGS:\s*([a-z]+)\s*\]/i.exec(text)?.[1]?.toLowerCase();
  if (settings && settingsPages[settings]) actions.openSettingsPage?.(settingsPages[settings]);
}
