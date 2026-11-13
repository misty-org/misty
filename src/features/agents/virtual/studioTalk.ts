import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import type { AgentProfile } from "@/shared/schemas";
import { runtimeAiApi } from "../AgentsRuntime";
import { followReply, latestReply } from "../conversations/state/backgroundReplies";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import { historyTurns } from "../conversations/state/localChats";
import { newLocalConversation } from "../conversations/state/localConversation";
import {
  conversationMessage,
  patchConversationMessage,
  settleConversationMessage,
  updateConversation,
} from "../conversations/state/mistyStoreUpdates";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { visibleConversationContent } from "../conversations/view/conversationTurns";
import { steerRunningTask } from "../conversations/view/conversationSend";
import { chatDeviceGrants } from "../personal/deviceGrants";

/**
 * Talking to an agent from the studio. What is said there goes into one of the agent's ordinary
 * chats, kept in misty.db like any other, so the chat page shows it too; its run is followed in
 * the background, so several agents can be talked to at once.
 */

const set = useMistyStore.setState;
const get = useMistyStore.getState;

/** A task given to several agents at once from the studio. */
interface Huddle {
  id: string;
  /** What they were all given, as the person typed it. */
  task: string;
  /** Each agent on it, with the chat its part runs in. */
  chats: Record<string, string>;
  startedAt: number;
}

interface StudioTalkState {
  /** The chat each agent is talked to in from the studio, once one was chosen or started. */
  chats: Record<string, string>;
  /** Agents whose next message from the studio starts a new chat. */
  fresh: Record<string, boolean>;
  huddles: Huddle[];
}

export const useStudioTalk = create<StudioTalkState>(() => ({ chats: {}, fresh: {}, huddles: [] }));

const replyOpen = (message: { state?: string } | undefined) =>
  message?.state === "pending" || message?.state === "streaming";

/**
 * The chat an agent is talked to in from the studio: the one last used there, else the one its
 * latest run was in, else its most recent chat. None when it has never been talked to, or when
 * the person asked for a new chat.
 */
export function studioChatOf(
  agentId: string,
  runChat: string,
  conversations: readonly GlobalAiConversation[],
  talk: Pick<StudioTalkState, "chats" | "fresh">,
): GlobalAiConversation | undefined {
  if (talk.fresh[agentId]) return undefined;
  const own = chatsOf(conversations, agentId);
  const byId = (id: string | undefined) => (id ? own.find((chat) => chat.id === id) : undefined);
  return byId(talk.chats[agentId]) ?? byId(runChat) ?? own[0];
}

/** Whether an agent is still answering in a chat. */
export const isAnswering = (conversations: readonly GlobalAiConversation[], chatId: string) =>
  replyOpen(latestReply(conversations, chatId));

/** The next message from the studio to this agent starts a new chat. */
export function startFresh(agentId: string) {
  useStudioTalk.setState((state) => ({ fresh: { ...state.fresh, [agentId]: true } }));
}

/** Talks to an agent in one of its chats from now on. */
export function chooseChat(agentId: string, chatId: string) {
  useStudioTalk.setState((state) => {
    const fresh = { ...state.fresh };
    delete fresh[agentId];
    return { chats: { ...state.chats, [agentId]: chatId }, fresh };
  });
}

/** An agent's chats, newest first. */
export const chatsOf = (conversations: readonly GlobalAiConversation[], agentId: string) =>
  conversations
    .filter((chat) => chat.agentId === agentId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

const firstLine = (text: string) => (text.trim().split("\n")[0] ?? "").slice(0, 56);

/**
 * Says something to an agent: into the chat given, or a new one when none is. While its run in
 * that chat is the one the chat page follows, the message steers that run, as it would there;
 * while another run of its is still answering there, nothing is sent. Returns the chat it went to.
 */
export async function talkTo(
  agent: AgentProfile,
  prompt: string,
  chatId: string | undefined,
): Promise<string> {
  const text = prompt.trim();
  if (!text) throw new Error("Say something first.");
  if (!agent.enabled) throw new Error(`${agent.name} is turned off. Turn it on in its settings.`);
  const store = get();
  const accountId = store.accountId;
  const known = chatId ? store.conversations.find((chat) => chat.id === chatId) : undefined;
  if (known && store.working && store.invocationConversationId === known.id) {
    await steerRunningTask(accountId, store.invocationId, text, known.id);
    return known.id;
  }
  if (known && isAnswering(store.conversations, known.id))
    throw new Error(`${agent.name} is still answering. Stop it, or wait until it's done.`);

  const asked = conversationMessage("user", "ask", text);
  const reply = conversationMessage("assistant", "ask", "");
  const now = new Date().toISOString();
  let chat: GlobalAiConversation;
  if (known) {
    // The earlier turns are read before this one is added, as the chat page does.
    chat = known;
    updateConversation(set, get, known.id, (conversation) => ({
      ...conversation,
      updatedAt: now,
      messages: [...conversation.messages, asked, reply],
    }));
  } else {
    chat = {
      ...newLocalConversation(firstLine(text) || agent.name, undefined, agent.id),
      messages: [asked, reply],
    };
    set({ conversations: [chat, ...get().conversations] });
  }
  useStudioTalk.setState((state) => {
    const fresh = { ...state.fresh };
    delete fresh[agent.id];
    return { chats: { ...state.chats, [agent.id]: chat.id }, fresh };
  });
  try {
    const created = await runtimeAiApi.createInvocation({
      mode: "drawer",
      surfaceId: "global",
      trigger: "message",
      prompt: text,
      context: [],
      agentId: agent.id,
      conversationId: chat.id,
      executionMode: "user",
      historyTurns: historyTurns(known),
      historyNotes: known?.historyNotes,
      deviceContexts: await chatDeviceGrants(chat.id, false).catch(() => []),
      idempotencyKey: `studio:${reply.id}`,
    });
    patchConversationMessage(set, get, chat.id, reply.id, { invocationId: created.invocationId });
    followReply(chat.id, reply.id, created.invocationId);
  } catch (error) {
    settleConversationMessage(set, get, chat.id, reply.id, {
      state: "failed",
      content: error instanceof Error ? error.message : String(error),
      retryable: false,
    });
  }
  return chat.id;
}

/** Stops whatever the agent is still answering in a chat. */
export async function stopAnswering(chatId: string) {
  const reply = latestReply(get().conversations, chatId);
  if (!reply?.invocationId || !replyOpen(reply)) return;
  await runtimeAiApi.cancelInvocation(reply.invocationId);
}

/**
 * Gives one task to several agents at once: each starts on it in a new chat, told who else has it
 * so they can keep out of each other's way, and they work it out at the meeting table.
 */
export async function huddle(
  agents: { agent: AgentProfile; name: string }[],
  task: string,
): Promise<Huddle> {
  const chats: Record<string, string> = {};
  for (const { agent } of agents) {
    const others = agents.filter((item) => item.agent.id !== agent.id).map((item) => item.name);
    const note =
      `You're one of several agents given this task at once; the others are ${others.join(", ")}. ` +
      "They work in the same folder, so keep to your own part and don't undo theirs.";
    useStudioTalk.setState((state) => ({ fresh: { ...state.fresh, [agent.id]: true } }));
    chats[agent.id] = await talkTo(agent, `${task}\n\n${note}`, undefined);
    useStudioTalk.setState((state) => ({
      chats: { ...state.chats, [agent.id]: chats[agent.id]! },
    }));
  }
  const made: Huddle = { id: crypto.randomUUID(), task, chats, startedAt: Date.now() };
  useStudioTalk.setState((state) => ({ huddles: [...state.huddles, made] }));
  return made;
}

/** One agent's part in a group task, as the meeting room's board shows it. */
export interface BoardRow {
  agentId: string;
  state: "working" | "done" | "failed";
}

/** The group task the board shows: the newest one of the day, still up once it is done, so its
 * outcome can be read off the board until another takes its place. */
export const BOARD_MS = 24 * 60 * 60_000;
export function boardOf(
  huddles: readonly Huddle[],
  conversations: readonly GlobalAiConversation[],
  now: number,
): { task: string; rows: BoardRow[] } | null {
  const item = huddles[huddles.length - 1];
  if (!item || now - item.startedAt >= BOARD_MS) return null;
  const rows = Object.entries(item.chats).map(([agentId, chatId]): BoardRow => {
    const reply = latestReply(conversations, chatId);
    if (replyOpen(reply)) return { agentId, state: "working" };
    return { agentId, state: reply?.state === "completed" ? "done" : "failed" };
  });
  return { task: item.task, rows };
}

/** The agents still working on a huddle's task; a huddle nobody is answering in is over. */
export function huddledAgents(
  huddles: readonly Huddle[],
  conversations: readonly GlobalAiConversation[],
): Set<string> {
  const busy = new Set<string>();
  for (const item of huddles) {
    for (const [agentId, chatId] of Object.entries(item.chats))
      if (isAnswering(conversations, chatId)) busy.add(agentId);
  }
  return busy;
}

/**
 * What an agent is saying in the studio: its reply while it answers something asked there, and
 * for a little while after it ended (`endedAt`). While it is still talking the newest words show;
 * once done, the start.
 */
const SPEECH_MS = 15_000;
export function speechOf(
  conversations: readonly GlobalAiConversation[],
  chatId: string | undefined,
  endedAt: number | undefined,
  now: number,
  most = 140,
): string {
  if (!chatId) return "";
  const reply = latestReply(conversations, chatId);
  if (!reply) return "";
  // As the chat page shows it: Tutor's tags and private context left out.
  const text = visibleConversationContent(reply.content, "assistant")
    .replace(/[#*_`>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (replyOpen(reply)) {
    if (!text) return "…";
    return text.length > most ? `…${text.slice(-most)}` : text;
  }
  if (!text || endedAt === undefined || now - endedAt >= SPEECH_MS) return "";
  return text.length > most ? `${text.slice(0, most)}…` : text;
}

/**
 * What each agent talked to from the studio is saying now. A reply that ends while the studio
 * watches stays up for `SPEECH_MS`; one that ended before it opened isn't shown again.
 */
export function useStudioSpeech(chats: Record<string, string>): Map<string, string> {
  const conversations = useMistyStore((state) => state.conversations);
  const open = useRef(new Set<string>());
  const ended = useRef(new Map<string, number>());
  const [clock, setClock] = useState(0);
  const speech = useMemo(() => {
    void clock;
    const now = Date.now();
    const said = new Map<string, string>();
    for (const [agentId, chatId] of Object.entries(chats)) {
      if (isAnswering(conversations, chatId)) {
        open.current.add(chatId);
        ended.current.delete(chatId);
      } else if (open.current.delete(chatId)) ended.current.set(chatId, now);
      const words = speechOf(conversations, chatId, ended.current.get(chatId), now);
      if (words) said.set(agentId, words);
    }
    return said;
  }, [chats, conversations, clock]);
  useEffect(() => {
    const now = Date.now();
    const left = [...ended.current.values()]
      .map((at) => at + SPEECH_MS - now)
      .filter((wait) => wait > 0);
    if (!left.length) return;
    const timer = window.setTimeout(() => setClock((known) => known + 1), Math.min(...left) + 20);
    return () => window.clearTimeout(timer);
  }, [speech]);
  return speech;
}
