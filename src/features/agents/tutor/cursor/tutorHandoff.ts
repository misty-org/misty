import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  spaceForNewItems,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/app-windows";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AgentProfile } from "@/shared/schemas";
import { newLocalConversation } from "../../conversations/state/localConversation";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import { homeSpaceOf, ownSpaceOf } from "../../personal/agentHomeSpace";
import { usePersonalAgentsStore } from "../../personal/personalAgentsStore";
import { useLocalExecution } from "../../runs/local-execution/localExecutionState";
import { useChatFolders } from "../../shared-folders/chatFolder";
import { useLessonStore } from "../lessons/lessonStore";
import { tutorChatIds, useTutorStore } from "../tutorStore";
import type { DisplayCapture } from "./protocol";

/**
 * Work Tutor is asked for goes to one of the person's agents, into that agent's own thread (its
 * direct message), never into Tutor's conversation or whichever chat happens to be open.
 */

/** The agents Tutor can hand work to: the ones the sidebar lists as direct messages. */
export function handoffAgents(): AgentProfile[] {
  return usePersonalAgentsStore
    .getState()
    .agents.filter((agent) => agent.enabled && !agent.system_managed);
}

const normal = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** The agent with this name: the same name, else the one agent whose name starts with it. */
export function agentNamed(name: string | undefined): AgentProfile | undefined {
  const wanted = normal(name ?? "").replace(/^@/, "");
  if (!wanted) return undefined;
  const agents = handoffAgents();
  const same = agents.filter((agent) => normal(agent.name) === wanted);
  if (same.length === 1) return same[0];
  const starting = agents.filter((agent) => normal(agent.name).startsWith(wanted));
  return starting.length === 1 ? starting[0] : undefined;
}

/**
 * An agent's thread, as the sidebar finds it: its most recently used chat that is listed with the
 * chats (not archived, not a project's, a lesson's, the Lab's or a place's own). None yet means
 * the hand-off starts it.
 */
export function agentThreadId(agentId: string): string | undefined {
  const projectChats = useChatFolders.getState().projectChats ?? {};
  const lessons = useLessonStore.getState().lessons;
  const { jobs, notebooks } = useTutorStore.getState();
  const made = tutorChatIds(jobs, notebooks);
  let thread: { id: string; updatedAt: string } | undefined;
  for (const chat of useMistyStore.getState().conversations)
    if (
      chat.agentId === agentId &&
      !chat.archivedAt &&
      !chat.place &&
      chat.messages.length > 0 &&
      !projectChats[chat.id] &&
      !lessons[chat.id] &&
      !made.has(chat.id) &&
      (!thread || chat.updatedAt > thread.updatedAt)
    )
      thread = chat;
  return thread?.id;
}

/** When an agent's thread was last used, for picking the most recent agent. */
function lastUsed(agentId: string): string {
  const id = agentThreadId(agentId);
  return useMistyStore.getState().conversations.find((chat) => chat.id === id)?.updatedAt ?? "";
}

const mostRecent = (agents: AgentProfile[]) =>
  agents.reduce<AgentProfile | undefined>(
    (best, agent) => (!best || lastUsed(agent.id) > lastUsed(best.id) ? agent : best),
    undefined,
  );

/** The agent working on something now: the running turn's, or the one using the desktop. */
export function workingAgent(): AgentProfile | undefined {
  const state = useMistyStore.getState();
  const agents = handoffAgents();
  const running = state.working
    ? state.conversations.find((chat) => chat.id === state.invocationConversationId)?.agentId
    : undefined;
  const driving = useLocalExecution.getState().execution?.agentId;
  return agents.find((agent) => agent.id === running) ?? agents.find((a) => a.id === driving);
}

/**
 * Who takes work no agent was named for: the agent working on what's on screen, else the agent
 * whose home is the Space the window shows (the most recent of them), else the person's most
 * recent agent. Undefined only when the person has no agents.
 */
export function pickAgent(named?: string): AgentProfile | undefined {
  const asked = agentNamed(named);
  if (asked) return asked;
  const working = workingAgent();
  if (working) return working;
  const agents = handoffAgents();
  const account = useMistyStore.getState().accountId;
  const { spaceId, personal } = spaceForNewItems();
  const here = personal ? ownSpaceOf(account) : (spaceId ?? "");
  const home = here ? agents.filter((agent) => homeSpaceOf(account, agent) === here) : [];
  return mostRecent(home) ?? mostRecent(agents);
}

/** Opens a page of this window, brought to the front over the app the person is in. */
function openInWindow(route: string) {
  const surface = workspaceSurfaceFromRoute(route);
  if (!surface) return;
  if (hasTauriInternals()) {
    const window = getCurrentWindow();
    void window
      .show()
      .then(() => window.setFocus())
      .catch(() => undefined);
  }
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== route) workspace.updateViewRoute(view.id, route, true);
}

/** Opens the agent's thread, on the chat the work went to. */
export function openAgentThread(agentId: string, conversationId?: string) {
  const params = new URLSearchParams({ agent: agentId });
  if (conversationId) params.set("conversation", conversationId);
  openInWindow(`/agents?${params}`);
}

/** Says there's no agent to hand work to, with the way to make one. */
export class NoAgentError extends Error {
  constructor() {
    super("You have no agents yet. Make one to hand work to.");
  }
}

/**
 * Sends the person's words, with their screens, into the agent's thread as a new turn, leaving
 * what the window has open alone. Resolves to the turn's invocation, or throws why it couldn't
 * start.
 */
export async function handOff(input: {
  agent: AgentProfile;
  instruction: string;
  key: string;
  turn: number;
  interactionMode: "team" | "auto";
  screens: DisplayCapture[];
}): Promise<{ invocationId: string; conversationId: string }> {
  let conversationId = agentThreadId(input.agent.id);
  if (!conversationId) {
    const thread = newLocalConversation("New conversation", undefined, input.agent.id);
    useMistyStore.setState((state) => ({
      conversations: [thread, ...state.conversations.filter((c) => c.id !== thread.id)],
    }));
    conversationId = thread.id;
  }
  const before = useMistyStore.getState();
  const restore = { agent: before.selectedAgentId, active: before.activeConversationId };
  useMistyStore.setState({ selectedAgentId: input.agent.id });
  try {
    await useMistyStore.getState().submitAnswer(
      input.instruction,
      [],
      undefined,
      [],
      { conversationId, context: [] },
      {
        turn: input.turn,
        executionMode: "user",
        interactionMode: input.interactionMode,
        idempotencyKey: input.key,
        ...(input.screens.length ? { displayCaptures: input.screens } : {}),
      },
    );
  } finally {
    // The person stays where they were; the work goes on in the agent's thread.
    if (useMistyStore.getState().accountId === before.accountId)
      useMistyStore.setState({
        selectedAgentId: restore.agent,
        activeConversationId: restore.active,
      });
  }
  const after = useMistyStore.getState();
  if (after.error) throw new Error(after.error);
  if (!after.invocationId || after.invocationConversationId !== conversationId)
    throw new Error(`${input.agent.name} couldn't start this. Try again in a moment.`);
  return { invocationId: after.invocationId, conversationId };
}
