import { apiRequest } from "@/api/client";
import type { GlobalAiConversation } from "../conversations/state/conversation_types";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { startRun } from "../conversations/start_run";

const pickUpMark = "Pick up:";

const pickUpPrompt = [
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

export function pickUpTitle(chatTitle: string): string {
  const topic = chatTitle.replace(/\s+/g, " ").trim().slice(0, 100) || "Untitled work";
  return `${pickUpMark} ${topic}`;
}

export function pickUpTopic(title: string): string | undefined {
  const trimmed = title.trimStart();
  if (trimmed.slice(0, pickUpMark.length).toLowerCase() !== pickUpMark.toLowerCase()) {
    return undefined;
  }
  return trimmed.slice(pickUpMark.length).trim() || "Untitled work";
}

interface PickUpOrigin {
  agentName: string;
  engine: string;
  folder: string;
  at: Date;
}

export function pickUpMarkdown(text: string, origin: PickUpOrigin): string {
  const from = `${[
    `From ${origin.agentName}`,
    origin.engine && origin.engine.toLowerCase() !== origin.agentName.toLowerCase()
      ? `on ${origin.engine}`
      : "",
    origin.folder ? `in ${origin.folder}` : "",
  ]
    .filter(Boolean)
    .join(" ")}, ${origin.at.toISOString().slice(0, 16).replace("T", " ")}`;
  const body = text.trim().slice(0, limit);
  return `${body}\n\n---\n\n${from}\n`;
}

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
const draftTimeoutMs = 3 * 60 * 1000;

export async function draftPickUp(
  conversationId: string,
  onProgress?: (text: string) => void,
): Promise<string> {
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
      if (!reply || reply.id === before) return;
      if (!finished.has(reply.state ?? "completed")) {
        if (reply.content.trim()) onProgress?.(reply.content.trim());
        return;
      }
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

export function sendPickUp(spaceId: string, title: string, markdown: string) {
  return apiRequest<{ id: string }>(notesPath(spaceId), {
    method: "POST",
    body: JSON.stringify({ title, markdown }),
  });
}
