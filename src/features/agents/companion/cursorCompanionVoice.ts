import { conversationForGlobalPrompt } from "@/features/global-search/globalMistyConversationScope";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  CompanionConversation,
  type ConversationTool,
  type SavedVoiceTurn,
} from "./companionConversation";
import { mergeVoiceTurn } from "./companionConversationHistory";
import type { CompanionOrigin, CursorCompanionSession } from "./cursorCompanionSession";

/**
 * The spoken conversation: one realtime voice session per Misty conversation,
 * the task tools it may call, and reading finished results aloud.
 */
export class CursorCompanionVoice {
  constructor(private readonly s: CursorCompanionSession) {}

  speechFailed = (id: string, generation: number, reason: unknown) => {
    const s = this.s;
    if (!s.active(generation)) return;
    s.stopAudio();
    s.speechRetry = id;
    const detail = reason instanceof Error ? reason.message : String(reason);
    s.change({
      phase: "idle",
      visible: true,
      error: `The answer is saved in the conversation. Speech failed: ${detail}`,
    });
    // Pointing has independent ownership and can finish even when TTS fails.
  };

  speak = async (id: string, generation: number) => {
    const s = this.s;
    s.speechRetry = undefined;
    s.voicePending = true;
    const controller = s.abort ?? new AbortController();
    s.abort = controller;
    try {
      // While the character flies to a point, keep it visible instead of a spinner.
      if (!s.pointPending) s.change({ phase: "processing" });
      await this.start().readResult(id);
      if (!s.active(generation)) return;
      s.voicePending = false;
      s.change({ phase: "idle" });
      s.maybeHide();
    } catch (error) {
      if (!controller.signal.aborted) this.speechFailed(id, generation, error);
    }
  };

  saveTurn = (saved: SavedVoiceTurn, conversationId: string) => {
    if (!saved.prompt) return; // Task summaries already have a durable task result.
    if (this.s.disposed || useMistyStore.getState().accountId !== this.s.accountId) return;
    useMistyStore.setState((current) => ({
      conversations: current.conversations.map((c) =>
        c.id === conversationId ? mergeVoiceTurn(c, saved) : c,
      ),
    }));
  };

  tool = async (tool: ConversationTool, conversationId: string) => {
    const s = this.s;
    const origin = s.conversationScope;
    if (!origin || origin.conversationId !== conversationId || !s.originIsCurrent(origin))
      throw new Error("The voice conversation changed.");
    const current = useMistyStore.getState();
    if (tool.name === "start_task" || tool.name === "show_on_screen") {
      if (current.working) throw new Error("A task is already running; use steering.");
      const generation = s.turn;
      const show = tool.name === "show_on_screen";
      // A screen question is answered from the screens as they are now. A task
      // opens a screen or looks at the user's screen itself when it needs one.
      s.captures = [];
      const screens = show ? await s.capture(generation, new AbortController().signal) : [];
      if (!s.originIsCurrent(origin) || !s.active(generation)) return undefined;
      if (useMistyStore.getState().working)
        throw new Error("A task is already running; use steering.");
      s.captures = screens;
      await useMistyStore.getState().submitAnswer(
        tool.instruction,
        [],
        undefined,
        "workspace",
        [],
        { conversationId, context: [] },
        {
          turn: generation,
          executionMode: "user",
          interactionMode: s.state.mode,
          model: s.state.model,
          idempotencyKey: tool.key,
          ...(show ? { displayCaptures: screens, intent: "teach" as const } : {}),
        },
      );
      const admitted = useMistyStore.getState();
      if (!s.originIsCurrent(origin)) return undefined;
      if (admitted.error) throw new Error(admitted.error);
      if (admitted.invocationId) {
        s.delegatedTask = { id: admitted.invocationId, conversationId };
        queueMicrotask(() => this.settleDelegatedTask());
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

  /** The voice session for the open conversation, started if needed. */
  start = () => {
    const s = this.s;
    if (s.conversationVoice && s.conversationScope && s.originIsCurrent(s.conversationScope))
      return s.conversationVoice;
    s.closeConversationVoice();
    const scope: CompanionOrigin = {
      conversationId: useMistyStore.getState().activeConversationId,
      agentId: useMistyStore.getState().selectedAgentId,
    };
    s.conversationScope = scope;
    const session: CompanionConversation = new CompanionConversation({
      conversation: async () => {
        s.creatingConversation = true;
        try {
          const id = await conversationForGlobalPrompt(useMistyStore.getState, "");
          if (
            s.disposed ||
            useMistyStore.getState().accountId !== s.accountId ||
            s.conversationScope !== scope
          )
            throw new Error("Voice session canceled.");
          scope.conversationId = id;
          if (s.recordingOrigin) s.recordingOrigin = { ...scope };
          return id;
        } finally {
          s.creatingConversation = false;
        }
      },
      assertCurrent: () => {
        if (s.disposed || s.conversationScope !== scope || !s.originIsCurrent(scope))
          throw new Error("Voice conversation changed.");
      },
      onPlaying: () => {
        if (s.conversationVoice === session && s.state.phase !== "listening")
          s.change({ phase: "responding" });
      },
      onTranscript: (id, text) => {
        if (s.originIsCurrent(scope))
          useMistyStore.setState((current) => ({
            error: current.error?.startsWith("Voice: ") ? null : current.error,
          }));
        this.saveTurn({ id, prompt: text, reply: "", interrupted: false }, scope.conversationId);
      },
      onDone: (saved) => {
        this.saveTurn(saved, scope.conversationId);
        if (s.conversationVoice === session && s.state.phase !== "listening") {
          s.change({ phase: "idle" });
          s.maybeHide();
        }
        queueMicrotask(() => this.settleDelegatedTask());
      },
      onError: (error) => {
        if (s.conversationVoice !== session) return;
        if (s.originIsCurrent(scope))
          useMistyStore.setState(() => ({ error: `Voice: ${error.message}` }));
        s.closeConversationVoice();
        s.change({ phase: "idle", visible: true, error: error.message });
      },
      onExpired: () => {
        if (s.conversationVoice === session) s.closeConversationVoice();
      },
      tool: this.tool,
    });
    s.conversationVoice = session;
    return session;
  };

  /**
   * Points at and reads back a task the voice conversation started, once it
   * finishes. A task that asked to look at or open a screen is answered by its
   * continuation, so that answer is the one pointed at and read aloud.
   */
  settleDelegatedTask = () => {
    const s = this.s;
    let task = s.delegatedTask;
    const current = useMistyStore.getState();
    if (
      !task ||
      s.disposed ||
      current.accountId !== s.accountId ||
      current.activeConversationId !== task.conversationId
    )
      return;
    if (task.awaitingContinuation) {
      if (
        current.invocationId &&
        current.invocationId !== task.id &&
        current.invocationConversationId === task.conversationId
      ) {
        task = { id: current.invocationId, conversationId: task.conversationId };
        s.delegatedTask = task;
      } else if (openingScreen(this.reply(task.id)?.screenRequest?.state)) return;
    }
    // Wait while the person is talking or a spoken reply plays.
    if (
      current.working ||
      current.invocationId !== task.id ||
      s.state.phase === "listening" ||
      s.state.phase === "responding"
    )
      return;
    const reply = this.reply(task.id);
    if (
      reply?.state === "completed" &&
      !task.awaitingContinuation &&
      openingScreen(reply.screenRequest?.state)
    ) {
      s.delegatedTask = { ...task, awaitingContinuation: true };
      return;
    }
    s.delegatedTask = undefined;
    if (reply?.state === "completed") {
      s.pointer.present(reply.content, task.id, true);
      void this.speak(task.id, s.turn);
      return;
    }
    if (s.state.phase === "processing") s.change({ phase: "idle" });
    s.maybeHide();
  };

  /** Whether a typed continuation answers a spoken request in this conversation. */
  ownsContinuation = (conversationId: string) =>
    Boolean(
      this.s.delegatedTask?.awaitingContinuation &&
      this.s.delegatedTask.conversationId === conversationId,
    );

  private reply = (invocationId: string) =>
    useMistyStore
      .getState()
      .conversations.find((c) => c.id === useMistyStore.getState().activeConversationId)
      ?.messages.find((m) => m.role === "assistant" && m.invocationId === invocationId);
}

/** A screen the task asked for is still being chosen or opened. */
function openingScreen(state: string | undefined) {
  return state === "pending" || state === "opening";
}
