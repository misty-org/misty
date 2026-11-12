import { apiRequest } from "@/api/client";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { startRun } from "../tutor/tutorRuns";

/**
 * Pick-ups: where an agent left off, so the next one, on any engine, starts there. The agent drafts
 * it in its own chat, the person reads and edits it, and only then is it sent to the Space as a
 * note, so nothing a model wrote reaches the server unapproved. A note is a pick-up by its title.
 */
export const pickUpMark = "Pick up:";

/** What the agent is asked for. It answers in its chat, where the person sees it being written. */
export const pickUpPrompt = [
  "Write a pick-up note for whoever continues this work next. It may be another agent on a",
  "different engine with none of this chat, so be concrete. Don't change any files or run",
  "anything. Answer with only the note, in Markdown, under these headings:",
  "## Done",
  "## Decisions",
  "## Open questions",
  "## Next step",
  "## Files",
  "Keep it under 300 words. Under Files, list paths relative to the project folder.",
].join("\n");

const limit = 40_000;

/** A pick-up's title: the mark, then what the chat was about. */
export function pickUpTitle(chatTitle: string): string {
  const topic = chatTitle.replace(/\s+/g, " ").trim().slice(0, 100) || "Untitled work";
  return `${pickUpMark} ${topic}`;
}

/** Whether a note's title marks it as a pick-up, and the topic after the mark. */
export function pickUpTopic(title: string): string | undefined {
  const trimmed = title.trimStart();
  if (trimmed.slice(0, pickUpMark.length).toLowerCase() !== pickUpMark.toLowerCase()) {
    return undefined;
  }
  return trimmed.slice(pickUpMark.length).trim() || "Untitled work";
}

export interface PickUpOrigin {
  agentName: string;
  /** The engine's name as people know it ("Claude Code", "Codex"), or empty for Misty's own. */
  engine: string;
  /** The linked folder's name, never its full path. */
  folder: string;
  at: Date;
}

/** The note sent to the Space: the person's edited text, then where it came from. */
export function pickUpMarkdown(text: string, origin: PickUpOrigin): string {
  const from = [
    // An agent named after its engine ("Codex") isn't said twice.
    `From ${origin.agentName}${
      origin.engine && origin.engine.toLowerCase() !== origin.agentName.toLowerCase()
        ? ` on ${origin.engine}`
        : ""
    }`,
    origin.folder ? `in ${origin.folder}` : "",
    origin.at.toISOString().slice(0, 16).replace("T", " "),
  ]
    .filter(Boolean)
    .join(" · ");
  const body = text.trim().slice(0, limit);
  return `${body}\n\n---\n\n${from}\n`;
}

/** What a new chat is asked when it picks up from a note. */
export function pickUpRequest(topic: string, markdown: string): string {
  return [
    `Pick up this work where the last agent left off: ${topic}.`,
    "Read the note, check the files it names, then carry on with its next step.",
    "",
    markdown.trim(),
  ].join("\n");
}

function lastAssistant(conversation: GlobalAiConversation | undefined) {
  const last = conversation?.messages[conversation.messages.length - 1];
  return last?.role === "assistant" ? last : undefined;
}

const finished = new Set(["completed", "failed", "canceled"]);
const draftTimeoutMs = 10 * 60 * 1000;

/**
 * Asks the chat's own agent to draft the note, in that chat, and waits for its answer. Fails when
 * the chat is busy, the turn fails, or nothing comes back in ten minutes.
 */
export async function draftPickUp(conversationId: string): Promise<string> {
  const store = useMistyStore.getState();
  const conversation = store.conversations.find((chat) => chat.id === conversationId);
  if (!conversation?.agentId) throw new Error("This chat has no agent to ask.");
  if (store.working) throw new Error("Wait for the agent to finish first.");
  const before = lastAssistant(conversation)?.id;
  const started = await startRun({
    agentId: conversation.agentId,
    title: conversation.title,
    prompt: pickUpPrompt,
    mode: "act",
    background: false,
    stay: true,
    conversationId,
  });
  if (!started.started) throw new Error(started.error || "The agent couldn't start.");
  return new Promise<string>((resolve, reject) => {
    let stop = () => {};
    const timer = window.setTimeout(() => {
      stop();
      reject(new Error("The agent took too long. Try again."));
    }, draftTimeoutMs);
    const check = () => {
      const chat = useMistyStore.getState().conversations.find((c) => c.id === conversationId);
      const reply = lastAssistant(chat);
      if (!reply || reply.id === before || !finished.has(reply.state ?? "completed")) return;
      if (useMistyStore.getState().working) return;
      window.clearTimeout(timer);
      stop();
      if (reply.state === "completed" && reply.content.trim()) resolve(reply.content.trim());
      else reject(new Error("The agent didn't write a note. Try again."));
    };
    stop = useMistyStore.subscribe(check);
    check();
  });
}

const notesPath = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}/notes`;

/** Sends the person's approved note to the Space. Only this ever puts a pick-up on the server. */
export function sendPickUp(spaceId: string, title: string, markdown: string) {
  return apiRequest<{ id: string }>(notesPath(spaceId), {
    method: "POST",
    body: JSON.stringify({ title, markdown }),
  });
}
