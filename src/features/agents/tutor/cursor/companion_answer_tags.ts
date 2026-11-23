import type { ConversationTool } from "./companion_voice_socket";
import type { DisplayCapture } from "./protocol";

export interface AnswerActions {
  tool: (tool: ConversationTool, conversationId: string) => Promise<string | undefined>;
  openPage?: (url: string) => void;
  openSettingsPage?: (page: string) => void;
  openChat?: () => void;
  remember?: (line: string) => void;
  forget?: () => void;
  drive?: (
    request: string,
    conversationId: string,
    key: string,
    agent?: string,
  ) => Promise<string | undefined>;
}

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

const settingsPages: Record<string, string> = {
  voice: "voice",
  tutor: "agents-companion",
  shortcuts: "shortcuts",
  appearance: "appearance",
  engine: "models",
};

export const filtered = /safety|content (?:policy|filter)|usage polic|flagged|refus|harm/i;
export const filteredLine =
  "My engine's safety filter turned that one down. I can explain the ideas behind it instead, if that helps.";

export function openDocument(screens: DisplayCapture[]) {
  const window = screens.find((screen) => screen.document);
  if (!window?.document) return "";
  const app = window.app ? ` (${window.app})` : "";
  return (
    `The window in front${app} has ${window.document} open. When they ask about more than ` +
    "what's on screen (the whole document, the rest of the page), read it with your own tools."
  );
}

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
