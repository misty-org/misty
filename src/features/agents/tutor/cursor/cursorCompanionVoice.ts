import { conversationForGlobalPrompt } from "../../conversations/state/globalMistyConversationScope";
import { useCollaborationStore } from "../../plans/store";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import {
  CompanionConversation,
  type ConversationTool,
  type SavedVoiceTurn,
} from "./companionConversation";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openSettings, type SettingsSection } from "@/features/settings";
import { notify } from "@misty/ui";
import { onCall, openReading, soundOn } from "@/features/voice";
import { mergeVoiceTurn, voiceContext } from "./companionConversationHistory";
import { SpokenSentences, spokenParts } from "./companionSentences";
import { withTrail } from "./companionTrail";
import type { CompanionOrigin, CursorCompanionSession } from "./cursorCompanionSession";

const mutedNotice = /Mac/.test(navigator.platform)
  ? "Your Mac is muted, so the answer is on your clipboard."
  : "Your sound is off, so the answer is on your clipboard.";

/** What a driven task is told on top of the request: do it in front of them, saying each step. */
const driveNote =
  "Do this on their screen, in front of them, with desktop control in the app they're using. " +
  "Before each action, write one short plain sentence saying what you're about to do and why, " +
  "so they learn the app as you go. Don't stop to ask unless a step is risky.";

/** "Only this monitor" and the like: what was said picks the one screen to look at from now on. */
const oneMonitor =
  /\b(?:only|just)\b[^.?!]{0,30}\b(?:this|that|my|the)\s+(?:main\s+)?(?:monitor|screen|display)\b|\b(?:this|that)\s+(?:monitor|screen|display)\s+only\b/i;
const everyMonitor =
  /\b(?:all|both|every)\s+(?:of\s+)?(?:my\s+|the\s+)?(?:monitors|screens|displays)\b/i;

/**
 * The spoken conversation: one voice session per Misty conversation, heard by this computer's
 * recognizer and answered on the default engine, the tasks it hands to the person's agent, and
 * reading finished results aloud in the system voice.
 */
export class CursorCompanionVoice {
  /** Tasks whose work was read out as it happened, so their answer isn't read again at the end. */
  private narrated = new Set<string>();

  constructor(private readonly s: CursorCompanionSession) {}

  /**
   * Starts a task done in front of the person ([DRIVE:…]) and reads its steps aloud as the
   * agent writes them, so they hear what's being done and why while they watch.
   */
  drive = async (request: string, conversationId: string, key: string) => {
    const id = await this.tool(
      {
        callId: key,
        name: "start_task",
        instruction: `${request}\n\n${driveNote}`,
        key,
        invocationId: "",
      },
      conversationId,
    );
    if (id) this.narrate(id);
    return id;
  };

  private narrate = (invocationId: string) => {
    const s = this.s;
    const turn = s.turn;
    this.narrated.add(invocationId);
    const reading = openReading();
    const sentences = new SpokenSentences((sentence) => reading.add(sentence));
    let stop = () => {};
    const finished = () => {
      stop();
      void reading.end().catch(() => undefined);
    };
    stop = useMistyStore.subscribe(() => {
      // A new spoken turn takes the voice; the task carries on in its chat.
      if (!s.active(turn)) return finished();
      const reply = this.reply(invocationId);
      if (!reply) return;
      sentences.update(spokenParts(reply.content).text);
      if (reply.state === "completed" || reply.state === "failed" || reply.state === "canceled") {
        sentences.finish(spokenParts(reply.content).text);
        finished();
      }
    });
  };

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
      // A finished task isn't read out over a call; its answer is in the chat.
      if (!(await onCall())) await this.start().readResult(id);
      if (!s.active(generation)) return;
      s.voicePending = false;
      s.clearFocus();
      s.sketch.release();
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
    if (tool.name === "get_task_status") {
      // Read from this chat: the task's state and its saved answer, if it has one.
      const id =
        current.invocationConversationId === conversationId ? current.invocationId : undefined;
      if (!id) return JSON.stringify({ state: "none" });
      return JSON.stringify({
        invocation_id: id,
        state: current.working ? "running" : "completed",
        reply: (this.reply(id)?.content ?? "").slice(0, 6000),
      });
    }
    if (tool.name === "start_task") {
      if (current.working) throw new Error("A task is already running; use steering.");
      const generation = s.turn;
      // Every spoken request carries every display, the cursor's first; the
      // run decides what matters.
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
          // Teach mode steps go only to lesson chats (the shortcut opened one).
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
          // Admitted work is not announced; its progress shows until the answer is read.
          s.change({ phase: s.delegatedTask ? "processing" : "idle" });
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
      context: (conversationId) => {
        const state = useMistyStore.getState();
        const conversation = state.conversations.find((c) => c.id === conversationId);
        const task =
          state.invocationConversationId === conversationId ? (state.invocationId ?? "") : "";
        return { history: voiceContext(conversation), task };
      },
      taskResult: (invocationId) => this.reply(invocationId)?.content ?? "",
      // Every spoken turn carries every display, the cursor's first.
      screens: async (asked) => {
        const generation = s.turn;
        if (!s.nativeReady) return [];
        const all = await s.capture(generation, new AbortController().signal);
        // "Only this monitor" keeps Tutor to the screen they work on until they say otherwise.
        if (asked && everyMonitor.test(asked)) s.onlyDisplay = undefined;
        else if (asked && oneMonitor.test(asked))
          s.onlyDisplay = all.find((capture) => capture.primary)?.display.id;
        const kept =
          s.onlyDisplay === undefined
            ? all
            : all.filter((capture) =>
                capture.source === "desktop-window"
                  ? all.some((c) => c.primary && c.display.id === s.onlyDisplay)
                  : capture.display.id === s.onlyDisplay,
              );
        const captured = kept.some((capture) => capture.source !== "desktop-window") ? kept : all;
        const focused = await s.withFocusCapture(captured, generation);
        // What the person circled with the pointer while they asked, drawn on the screenshots.
        const { screens } = await withTrail(focused, generation);
        s.captures = screens;
        return screens;
      },
      companionMode: () => s.state.mode,
      present: (reply, runId) => {
        if (s.conversationVoice === session) s.pointer.present(reply, runId, true);
      },
      drawing: (answer, id, shown) => {
        if (s.conversationVoice === session) s.sketch.show(answer, `voice:${id}`, shown);
      },
      drawingRead: () => {
        if (s.conversationVoice === session) s.sketch.readOut();
      },
      onNothingHeard: () => {
        if (s.conversationVoice === session) s.notice("I didn't hear anything.", 2_500);
      },
      openPage: (url) => {
        if (s.conversationVoice === session) void openUrl(url).catch(() => undefined);
      },
      openSettingsPage: (page) => {
        if (s.conversationVoice !== session) return;
        // Settings opens in this window, brought to the front.
        const window = getCurrentWindow();
        void window
          .show()
          .then(() => window.setFocus())
          .catch(() => undefined);
        openSettings(page as SettingsSection);
      },
      drive: (request, conversationId, key) => this.drive(request, conversationId, key),
      onMuted: () => {
        if (s.conversationVoice !== session) return;
        s.notice(mutedNotice);
        // The overlay can't be clicked, so the fix waits in Misty's notices.
        if (/Mac/.test(navigator.platform))
          notify({
            id: "tutor-muted",
            message: mutedNotice,
            action: { label: "Turn sound on", onSelect: () => void soundOn().catch(() => {}) },
          });
      },
      onCaption: (sentence) => {
        if (s.conversationVoice === session) s.setSpoken(sentence);
      },
      onAnswered: (turn) => {
        if (s.conversationVoice !== session) return;
        if (s.tour.running) return s.tour.answered(turn);
        // Someone who has just talked to Tutor for the first time is shown the rest of it:
        // their hello was the tour's first step.
        if (!s.toured) {
          s.toured = true;
          s.tour.start(1);
        }
      },
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
      // Stop audio may have hidden the cursor while the task kept running.
      s.change({ visible: true });
      s.pointer.present(reply.content, task.id, true);
      // A task done in front of them was already read out step by step.
      if (this.narrated.delete(task.id)) {
        s.change({ phase: "idle" });
        s.maybeHide();
        return;
      }
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
