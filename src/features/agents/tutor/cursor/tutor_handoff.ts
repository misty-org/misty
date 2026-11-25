import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  spaceForNewItems,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/app-windows";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AgentProfile } from "@/shared/schemas";
import { newLocalConversation } from "../../conversations/state/local_conversation";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { homeSpaceOf, ownSpaceOf } from "../../personal/agent_home_space";
import { usePersonalAgentsStore } from "../../personal/personal_agents_store";
import { useLocalExecution } from "../../runs/local-execution/local_execution_state";
import { useLessonStore } from "../lessons/lesson_store";
import type { MistyImageAttachment } from "../../conversations/state/conversation_types";
import type { DisplayCapture } from "./protocol";

export function handoffAgents(): AgentProfile[] {
  return usePersonalAgentsStore
    .getState()
    .agents.filter((agent) => agent.enabled && !agent.system_managed);
}

const normal = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function agentNamed(name: string | undefined): AgentProfile | undefined {
  const wanted = normal(name ?? "").replace(/^@/, "");
  if (!wanted) return undefined;
  const agents = handoffAgents();
  const same = agents.filter((agent) => normal(agent.name) === wanted);
  if (same.length === 1) return same[0];
  const starting = agents.filter((agent) => normal(agent.name).startsWith(wanted));
  return starting.length === 1 ? starting[0] : undefined;
}

export function agentThreadId(agentId: string): string | undefined {
  const lessons = useLessonStore.getState().lessons;
  let thread: { id: string; updatedAt: string } | undefined;
  for (const chat of useMistyStore.getState().conversations)
    if (
      chat.agentId === agentId &&
      !chat.archivedAt &&
      !chat.place &&
      chat.messages.length > 0 &&
      !lessons[chat.id] &&
      (!thread || chat.updatedAt > thread.updatedAt)
    )
      thread = chat;
  return thread?.id;
}

function lastUsed(agentId: string): string {
  const id = agentThreadId(agentId);
  return useMistyStore.getState().conversations.find((chat) => chat.id === id)?.updatedAt ?? "";
}

const mostRecent = (agents: AgentProfile[]) =>
  agents.reduce<AgentProfile | undefined>(
    (best, agent) => (!best || lastUsed(agent.id) > lastUsed(best.id) ? agent : best),
    undefined,
  );

export function workingAgent(): AgentProfile | undefined {
  const state = useMistyStore.getState();
  const agents = handoffAgents();
  const running = state.working
    ? state.conversations.find((chat) => chat.id === state.invocationConversationId)?.agentId
    : undefined;
  const driving = useLocalExecution.getState().execution?.agentId;
  return agents.find((agent) => agent.id === running) ?? agents.find((a) => a.id === driving);
}

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

export function openAgentThread(agentId: string, conversationId?: string) {
  const params = new URLSearchParams({ agent: agentId });
  if (conversationId) params.set("conversation", conversationId);
  openInWindow(`/agents?${params}`);
}

export class NoAgentError extends Error {
  constructor() {
    super("You have no agents yet. Make one to hand work to.");
  }
}

export async function handOff(input: {
  agent: AgentProfile;
  instruction: string;
  shown?: string;
  key: string;
  turn: number;
  interactionMode: "team" | "auto";
  screens: DisplayCapture[];
  permissionMode?: "ask";
  conversationId?: string;
  attachments?: MistyImageAttachment[];
}): Promise<{ invocationId: string; conversationId: string }> {
  let conversationId = input.conversationId ?? agentThreadId(input.agent.id);
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
      input.attachments ?? [],
      undefined,
      [],
      { conversationId, context: [] },
      {
        turn: input.turn,
        executionMode: "user",
        interactionMode: input.interactionMode,
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        idempotencyKey: input.key,
        ...(input.shown ? { shown: input.shown } : {}),
        ...(input.screens.length ? { displayCaptures: input.screens } : {}),
      },
    );
  } finally {
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
