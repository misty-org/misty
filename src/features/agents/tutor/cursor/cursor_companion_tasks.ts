import { openSettings } from "@/features/settings";
import { notify } from "@misty/ui";
import { useCollaborationStore } from "../../plans/store";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import type { ConversationTool } from "./companion_conversation";
import type { CompanionOrigin, CursorCompanionSession } from "./cursor_companion_session";
import {
  agentNamed,
  handoffAgents,
  handOff,
  NoAgentError,
  openAgentThread,
  pickAgent,
} from "./tutor_handoff";
import { handoffStateOf } from "./tutor_handoff_state";

export function taskReply(s: CursorCompanionSession, invocationId: string) {
  const state = useMistyStore.getState();
  const where =
    s.delegatedTask?.id === invocationId
      ? s.delegatedTask.conversationId
      : state.activeConversationId;
  const mine = (m: { role: string; invocationId?: string }) =>
    m.role === "assistant" && m.invocationId === invocationId;
  const preferred = state.conversations.find((c) => c.id === where)?.messages.find(mine);
  if (preferred) return preferred;
  for (const conversation of state.conversations) {
    const found = conversation.messages.find(mine);
    if (found) return found;
  }
  return undefined;
}

export class CursorCompanionTasks {
  private handoffs = new Map<string, { agentId: string; conversationId: string }>();
  private lastHandoff: { agentId: string; conversationId: string } | undefined;

  constructor(
    private readonly s: CursorCompanionSession,
    private readonly settle: () => void,
  ) {}

  handoffFor = (turnId: string) =>
    this.handoffs.get(`voice-task:${turnId}`) ?? this.handoffs.get(`voice-drive:${turnId}`);

  handOff = async (tool: ConversationTool, origin: CompanionOrigin) => {
    const s = this.s;
    const agent = pickAgent(tool.agent);
    if (!agent) {
      notify({
        id: "tutor-no-agent",
        message: new NoAgentError().message,
        action: { label: "New agent", onSelect: () => openSettings("agents-list") },
      });
      throw new NoAgentError();
    }
    const current = useMistyStore.getState();
    if (current.working) {
      const thread = current.conversations.find((c) => c.id === current.invocationConversationId);
      if (thread?.agentId === agent.id && current.invocationId) {
        await current.steerResponse?.(tool.instruction, thread.id);
        return current.invocationId;
      }
      const busy = handoffAgents().find((a) => a.id === thread?.agentId)?.name;
      throw new Error(
        `${busy ?? "Another agent"} is working on something. Try again when it finishes.`,
      );
    }
    const generation = s.turn;
    s.captures = [];
    const screens = s.nativeReady
      ? await s
          .capture(generation, new AbortController().signal)
          .then((captured) => s.withFocusCapture(captured, generation))
          .catch(() => [])
      : [];
    if (!s.originIsCurrent(origin) || !s.active(generation)) return undefined;
    s.captures = screens;
    const started = await handOff({
      agent,
      instruction: tool.instruction,
      key: tool.key.replace(/^voice-/, "tutor-"),
      turn: generation,
      interactionMode: s.state.mode,
      screens,
    });
    this.handoffs.set(tool.key, { agentId: agent.id, conversationId: started.conversationId });
    this.lastHandoff = { agentId: agent.id, conversationId: started.conversationId };
    s.sketch.follow(started.invocationId);
    s.delegatedTask = {
      id: started.invocationId,
      conversationId: started.conversationId,
      handoff: { agentId: agent.id, instruction: tool.instruction, key: tool.key },
    };
    this.showHandoff();
    queueMicrotask(() => this.settle());
    return started.invocationId;
  };

  reassign = async (tool: ConversationTool, conversationId: string) => {
    const s = this.s;
    const task = s.delegatedTask;
    const agent = agentNamed(tool.agent || tool.instruction);
    if (!agent) throw new Error(`None of your agents is called ${tool.agent || tool.instruction}.`);
    if (!task?.handoff) throw new Error("There's nothing handed off to give to another agent.");
    if (task.handoff.agentId === agent.id) return task.id;
    const current = useMistyStore.getState();
    if (current.working && current.invocationId === task.id) {
      await current.cancelResponse?.();
      for (let waited = 0; useMistyStore.getState().working && waited < 5_000; waited += 100)
        await new Promise((wait) => setTimeout(wait, 100));
    }
    s.delegatedTask = undefined;
    return this.handOff(
      {
        ...tool,
        name: "start_task",
        instruction: task.handoff.instruction,
        agent: agent.name,
        key: `${task.handoff.key}:${agent.id}`,
      },
      s.conversationScope ?? { conversationId, tutor: true },
    );
  };

  showHandoff = () => {
    const s = this.s;
    const task = s.delegatedTask;
    const agent = task?.handoff && handoffAgents().find((a) => a.id === task.handoff!.agentId);
    if (!task || !agent) {
      if (s.state.handoff) s.change({ handoff: undefined });
      return;
    }
    const state = handoffStateOf(taskReply(this.s, task.id));
    const shown = s.state.handoff;
    if (shown?.agent.id === agent.id && shown.state === state && shown.task === task.id) return;
    s.change({
      handoff: {
        task: task.id,
        conversationId: task.conversationId,
        agent: { id: agent.id, name: agent.name, engine: agent.engine, avatar: agent.avatar },
        state,
      },
    });
  };

  openHandoff = () => {
    const last = this.lastHandoff;
    if (last) openAgentThread(last.agentId, last.conversationId);
  };

  lesson = async (tool: ConversationTool, conversationId: string, origin: CompanionOrigin) => {
    const s = this.s;
    const current = useMistyStore.getState();
    if (tool.name === "get_task_status") {
      const id =
        current.invocationConversationId === conversationId ? current.invocationId : undefined;
      if (!id) return JSON.stringify({ state: "none" });
      return JSON.stringify({
        invocation_id: id,
        state: current.working ? "running" : "completed",
        reply: (taskReply(this.s, id)?.content ?? "").slice(0, 6000),
      });
    }
    if (tool.name === "start_task") {
      if (current.working) throw new Error("A task is already running; use steering.");
      const generation = s.turn;
      s.captures = [];
      const screens = s.nativeReady
        ? await s
            .capture(generation, new AbortController().signal)
            .then((captured) => s.withFocusCapture(captured, generation))
            .catch(() => [])
        : [];
      if (!s.originIsCurrent(origin) || !s.active(generation)) return undefined;
      if (useMistyStore.getState().working)
        throw new Error("A task is already running; use steering.");
      s.captures = screens;
      await useMistyStore.getState().submitAnswer(
        tool.instruction,
        [],
        undefined,
        [],
        { conversationId, context: [] },
        {
          turn: generation,
          executionMode: "user",
          interactionMode: s.state.mode,
          idempotencyKey: tool.key,
          ...(screens.length ? { displayCaptures: screens } : {}),
          ...(s.state.teach && useCollaborationStore.getState().modeFor(conversationId) === "teach"
            ? { collaborationMode: "teach" as const }
            : {}),
        },
      );
      const admitted = useMistyStore.getState();
      if (!s.originIsCurrent(origin)) return undefined;
      if (admitted.error) throw new Error(admitted.error);
      if (admitted.invocationId) {
        s.sketch.follow(admitted.invocationId);
        s.delegatedTask = { id: admitted.invocationId, conversationId };
        queueMicrotask(() => this.settle());
      }
      return admitted.invocationId;
    }
    if (
      !current.working ||
      current.invocationId !== tool.invocationId ||
      current.invocationConversationId !== conversationId
    )
      throw new Error("No matching active task.");
    if (tool.name === "steer_task") await current.steerResponse?.(tool.instruction, conversationId);
    else if (tool.name === "cancel_task") await current.cancelResponse?.();
    else throw new Error("Unknown companion tool.");
    return tool.invocationId;
  };
}
