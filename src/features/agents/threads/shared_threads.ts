import { apiRequest } from "@/api/client";
import { spacesSnapshot } from "@/features/app-windows";
import type { AiProgressItem } from "../runs/invocations/invocation_types";
import type { GlobalAiConversation } from "../conversations/state/conversation_types";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { toolParts } from "../progress/progress_timeline";
import { homeSpaceOf } from "../personal/agent_home_space";
import { usePersonalAgentsStore } from "../personal/personal_agents_store";
import { continuationOf } from "./continuation";
import { useThreadWork, type ThreadOutput, type ThreadView } from "./thread_work";

export type SharedThreadState = "working" | "needs-you" | "landing" | "resting";

export type SharedEntryKind = "ask" | "reply" | "step" | "output";

export interface SharedThread {
  id: string;
  space_id: string;
  agent_id: string;
  owner_user_id: string;
  owner_name: string;
  title: string;
  state: SharedThreadState;
  continued_from: string | null;
  entries: number;
  created_at: string;
  updated_at: string;
}

export interface SharedReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface SharedEntry {
  key: string;
  seq: number;
  kind: SharedEntryKind;
  body: string;
  created_at: string;
  reactions: SharedReaction[];
}

interface EntryInput {
  key: string;
  kind: SharedEntryKind;
  body: string;
}

export const AGENT_THREAD_EVENT = "misty:agent-thread-event";

const MOST_TEXT = 20000;
const MOST_PER_CALL = 200;
const PAGE = 200;
const STEP_SPLIT = "\t";
const QUIET_MS = 1500;

const spacePath = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}`;
const threadPath = (spaceId: string, threadId: string) =>
  `${spacePath(spaceId)}/agent-threads/${encodeURIComponent(threadId)}`;

export const sharedThreadsApi = {
  list: (spaceId: string, agentId: string) =>
    apiRequest<{ threads: SharedThread[] }>(
      `${spacePath(spaceId)}/agents/${encodeURIComponent(agentId)}/threads`,
    ).then((result) => result.threads ?? []),
  put: (
    spaceId: string,
    threadId: string,
    body: { agent_id: string; title: string; state: SharedThreadState; continued_from?: string },
  ) =>
    apiRequest<SharedThread>(threadPath(spaceId, threadId), {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: (spaceId: string, threadId: string) =>
    apiRequest(threadPath(spaceId, threadId), { method: "DELETE" }),
  async entries(spaceId: string, threadId: string): Promise<SharedEntry[]> {
    const all: SharedEntry[] = [];
    let after = 0;
    for (;;) {
      const page = await apiRequest<{ entries: SharedEntry[] }>(
        `${threadPath(spaceId, threadId)}/entries?after=${after}`,
      ).then((result) => result.entries ?? []);
      all.push(...page);
      if (page.length < PAGE) return all;
      after = page[page.length - 1]!.seq;
    }
  },
  putEntries: (spaceId: string, threadId: string, entries: EntryInput[]) =>
    apiRequest<SharedThread>(`${threadPath(spaceId, threadId)}/entries`, {
      method: "POST",
      body: JSON.stringify({ entries }),
    }),
  react: (spaceId: string, threadId: string, key: string, emoji: string, on: boolean) =>
    apiRequest(`${threadPath(spaceId, threadId)}/reactions`, {
      method: "POST",
      body: JSON.stringify({ key, emoji, on }),
    }),
};

export function isSharedSpace(spaceId: string | undefined): boolean {
  if (!spaceId) return false;
  const space = spacesSnapshot().spaces.find((item) => item.id === spaceId);
  return Boolean(space && !space.is_default);
}

const cut = (text: string) => (text.length > MOST_TEXT ? text.slice(0, MOST_TEXT) : text);

const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function stepLines(progress: AiProgressItem[] | undefined): string {
  const lines: string[] = [];
  for (const item of progress ?? []) {
    if (item.type !== "tool") continue;
    const { verb, subject } = toolParts(item.name, false);
    const target = item.path ? fileName(item.path) : subject;
    lines.push(target ? `${verb}${STEP_SPLIT}${target}` : verb);
  }
  return lines.join("\n");
}

const settled = (state: string | undefined) =>
  state === undefined || state === "completed" || state === "failed" || state === "canceled";

export function entriesOf(chat: GlobalAiConversation, outputs: ThreadOutput[] | undefined) {
  const entries: EntryInput[] = [];
  for (const message of chat.messages) {
    if (message.role === "user") {
      const body = message.content.trim();
      if (body) entries.push({ key: `${message.id}:ask`, kind: "ask", body: cut(body) });
      continue;
    }
    if (!settled(message.state)) continue;
    const steps = stepLines(message.progress);
    if (steps) entries.push({ key: `${message.id}:steps`, kind: "step", body: cut(steps) });
    const body = message.content.trim();
    if (body) entries.push({ key: `${message.id}:reply`, kind: "reply", body: cut(body) });
  }
  if (outputs?.length) {
    const body = outputs.map((output) => output.path).join("\n");
    entries.push({ key: "outputs", kind: "output", body: cut(body) });
  }
  return entries;
}

function stateOf(view: ThreadView, working: boolean): SharedThreadState {
  if (view.state === "landing") return "landing";
  if (view.state === "clashed") return "needs-you";
  return working ? "working" : "resting";
}

const sent = new Map<string, string>();
const heads = new Map<string, string>();
const asked = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let again = false;

export function splitStep(line: string): { verb: string; target: string } {
  const at = line.indexOf(STEP_SPLIT);
  return at < 0
    ? { verb: line, target: "" }
    : { verb: line.slice(0, at), target: line.slice(at + STEP_SPLIT.length) };
}

function sharedAgentIds(account: string): Set<string> {
  return new Set(
    usePersonalAgentsStore
      .getState()
      .agents.filter((agent) => isSharedSpace(homeSpaceOf(account, agent)))
      .map((agent) => agent.id),
  );
}

async function publishChat(chat: GlobalAiConversation, view: ThreadView, working: boolean) {
  const outputs = useThreadWork.getState().outputs[chat.id];
  const state = stateOf(view, working);
  const title = chat.title.trim().slice(0, 200);
  const head = `${title}\u0000${state}`;
  if (heads.get(chat.id) !== head) {
    const continued = continuationOf(chat.id);
    await sharedThreadsApi.put(view.spaceId, chat.id, {
      agent_id: chat.agentId ?? "",
      title,
      state,
      ...(continued ? { continued_from: continued.threadId } : {}),
    });
    heads.set(chat.id, head);
  }
  const fresh = entriesOf(chat, outputs).filter(
    (entry) => sent.get(`${chat.id}\u0000${entry.key}`) !== entry.body,
  );
  for (let at = 0; at < fresh.length; at += MOST_PER_CALL) {
    const batch = fresh.slice(at, at + MOST_PER_CALL);
    await sharedThreadsApi.putEntries(view.spaceId, chat.id, batch);
    for (const entry of batch) sent.set(`${chat.id}\u0000${entry.key}`, entry.body);
  }
}

async function publish() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  again = false;
  try {
    const { conversations, working, invocationConversationId, accountId } =
      useMistyStore.getState();
    const work = useThreadWork.getState();
    const shared = sharedAgentIds(accountId);
    for (const chat of conversations) {
      if (!chat.agentId || !chat.messages.length || chat.place || !shared.has(chat.agentId))
        continue;
      const view = work.byConversation[chat.id];
      if (view === undefined) {
        if (!asked.has(chat.id)) {
          asked.add(chat.id);
          void work.load(chat.id).catch(() => asked.delete(chat.id));
        }
        continue;
      }
      if (!view || !isSharedSpace(view.spaceId)) continue;
      if (!(chat.id in work.outputs)) void work.loadOutputs(chat.id).catch(() => undefined);
      await publishChat(chat, view, working && invocationConversationId === chat.id).catch(
        () => undefined,
      );
    }
  } finally {
    running = false;
    if (again) soon();
  }
}

function soon() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void publish();
  }, QUIET_MS);
}

function follow(): () => void {
  const stopChats = useMistyStore.subscribe(soon);
  const stopThreads = useThreadWork.subscribe(soon);
  soon();
  return () => {
    stopChats();
    stopThreads();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

export function startSharedThreadsSync(): () => void {
  if (typeof navigator === "undefined" || !navigator.locks) return follow();
  const leaving = new AbortController();
  void navigator.locks
    .request("misty:shared-threads", { signal: leaving.signal }, () => {
      const stop = follow();
      return new Promise<void>((done) => {
        leaving.signal.addEventListener("abort", () => {
          stop();
          done();
        });
      });
    })
    .catch(() => undefined);
  return () => leaving.abort();
}
