import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { effectiveValues, useDevicePreferences } from "@/features/settings/preferenceAccess";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { invoke } from "@tauri-apps/api/core";
import type { CompanionConversation } from "./companionConversation";
import { normalizeCompanionSize } from "./companionSize";
import { useCompanionState } from "./companionState";
import { captureScreens, savedPresentation, withLessonCloseUp } from "./cursorCompanionScreens";
import { CursorCompanionPointer } from "./cursorCompanionPointer";
import { CursorCompanionSketch } from "./cursorCompanionSketch";
import type { MediaContext } from "./mediaContext";
import type { DisplayCapture, Presentation, PresentedFocus } from "./protocol";

export type CompanionOrigin = { conversationId: string; agentId?: string };

/**
 * One signed-in account's cursor companion: its presentation, turn ownership,
 * interruption and pointing. Voice, typed turns and native events share it.
 */
export class CursorCompanionSession {
  disposed = false;
  /** The native turn this window last owned; older events and replies are stale. */
  turn = 0;
  /** A typed turn this companion admitted and may cancel. */
  owned = false;
  pointPending = false;
  voicePending = false;
  nativeReady = false;
  barrier: Promise<void> = Promise.resolve();
  abort: AbortController | undefined;
  conversationVoice: CompanionConversation | undefined;
  conversationScope: CompanionOrigin | undefined;
  creatingConversation = false;
  /**
   * A task the voice conversation started, read aloud when it finishes. While
   * it waits for a screen it asked for, its continuation is the answer to read.
   */
  delegatedTask: { id: string; conversationId: string; awaitingContinuation?: boolean } | undefined;
  /** Pointing and walkthrough steps for finished replies. */
  readonly pointer: CursorCompanionPointer = new CursorCompanionPointer(this);
  /** A reply's drawing, drawn while it streams. */
  readonly sketch: CursorCompanionSketch = new CursorCompanionSketch(this);
  hideTimer: ReturnType<typeof setTimeout> | undefined;
  pointTimer: ReturnType<typeof setTimeout> | undefined;
  focusTimer: ReturnType<typeof setTimeout> | undefined;
  /** What the video in front was saying, looked up the moment the talk shortcut went down. */
  pendingMedia: { turn: number; lookup: Promise<MediaContext | undefined> } | undefined;
  /** The region the last lesson step pointed at; the next check captures it close up. */
  lastFocus: PresentedFocus | undefined;
  speechRetry: string | undefined;
  recordingOrigin: CompanionOrigin | undefined;
  show = true;
  state: Presentation;
  captures: DisplayCapture[] = [];
  recordedTurn = -1;
  submittedTurn = 0;
  invocationId: string | undefined;
  submittedConversationId: string | undefined;

  constructor(readonly accountId: string) {
    this.state = savedPresentation(accountId);
    this.show = this.state.visible;
  }

  originIsCurrent = (origin: CompanionOrigin) => {
    const current = useMistyStore.getState();
    return (
      current.accountId === this.accountId &&
      current.activeConversationId === origin.conversationId &&
      orDefaultAgent(current.selectedAgentId) === orDefaultAgent(origin.agentId)
    );
  };

  active = (generation: number) =>
    !this.disposed &&
    this.turn === generation &&
    useMistyStore.getState().accountId === this.accountId;

  publish = () => {
    if (this.disposed) return;
    useCompanionState.setState({
      accountId: this.accountId,
      presentation: this.state,
    });
    const published = this.state;
    if (this.nativeReady)
      void invoke("cursor_companion_present", {
        turn: this.turn,
        presentation: published,
      }).catch((reason) => {
        if (!this.disposed && this.active(published.generation))
          useCompanionState.setState({
            presentation: {
              ...this.state,
              error: String(reason),
            },
          });
      });
  };

  change = (patch: Partial<Presentation>) => {
    this.state = {
      ...this.state,
      ...patch,
      generation: this.turn,
      enabled: this.nativeReady,
      showCompanion: this.show,
    };
    this.publish();
  };

  applyPreferences = () => {
    const settings = useDevicePreferences.getState();
    if (!settings.state) return;
    const values = effectiveValues(settings.state);
    this.show = values["agents.companion.visible"] !== false;
    this.change({
      visible: this.show || this.state.phase !== "idle" || this.pointPending,
      size: normalizeCompanionSize(values["agents.companion.size"]),
      ask: values["agents.companion.ask"] === true,
      teach: values["agents.companion.teach"] === true,
      model:
        typeof values["agents.companion.model"] === "string"
          ? values["agents.companion.model"]
          : "",
    });
  };

  /**
   * Outlines where to look while Misty explains a step (Teach mode). A spoken step
   * keeps it until the speech ends; a typed one for `holdMs`.
   */
  showFocus = (focus: PresentedFocus[], holdMs?: number) => {
    clearTimeout(this.focusTimer);
    if (!focus.length) return this.clearFocus();
    this.lastFocus = focus[0];
    this.change({ focus });
    const expected = this.turn;
    // A spoken step clears when it is read; this bounds one whose speech never ends.
    this.focusTimer = setTimeout(() => {
      if (this.active(expected)) this.clearFocus();
    }, holdMs ?? 60_000);
  };

  clearFocus = () => {
    clearTimeout(this.focusTimer);
    if (this.state.focus) this.change({ focus: undefined });
  };

  maybeHide = () => {
    if (
      this.state.error ||
      this.voicePending ||
      this.pointPending ||
      this.state.phase === "listening" ||
      this.state.phase === "processing"
    )
      return;
    const expected = this.turn;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.active(expected) && !this.show && !this.state.error)
        this.change({
          visible: false,
        });
    }, 1000);
  };

  stopAudio = () => {
    void this.conversationVoice?.interrupt().catch(() => {});
    this.abort?.abort();
    this.abort = undefined;
    this.voicePending = false;
  };

  closeConversationVoice = () => {
    this.conversationVoice?.close();
    this.conversationVoice = undefined;
    this.conversationScope = undefined;
  };

  interrupt = (cancelTask = true) => {
    this.speechRetry = undefined;
    this.stopAudio();
    clearTimeout(this.hideTimer);
    clearTimeout(this.pointTimer);
    this.pointer.cancel();
    this.pointPending = false;
    const shouldCancel = this.owned && cancelTask;
    this.owned = false;
    clearTimeout(this.focusTimer);
    this.sketch.cancel();
    this.change({
      point: undefined,
      focus: undefined,
      sketch: undefined,
      phase: "idle",
      error: this.nativeReady ? undefined : this.state.error,
    });
    // Serialize cancellation with the next admission; never cancel an unrelated drawer turn.
    this.barrier = this.barrier
      .catch(() => {})
      .then(async () => {
        if (shouldCancel && !this.disposed && useMistyStore.getState().accountId === this.accountId)
          await useMistyStore.getState().cancelResponse?.();
      });
    return this.barrier;
  };

  fail = (generation: number, reason: unknown) => {
    if (!this.active(generation)) return;
    // Voice/overlay failures do not revoke an admitted task's execution.
    // Task cancellation belongs to explicit Stop or the execution owner.
    void this.interrupt(false);
    this.change({
      phase: "idle",
      point: undefined,
      error: reason instanceof Error ? reason.message : String(reason),
    });
    void invoke<number>("cursor_companion_interrupt", {
      expectedTurn: generation,
    })
      .then((next) => {
        if (this.active(generation)) {
          this.turn = next;
          this.change({});
          this.maybeHide();
        }
      })
      .catch(() => {});
    this.maybeHide();
  };

  interruptNative = async (cancelTask = true) => {
    const previous = this.turn;
    const next = this.nativeReady
      ? await invoke<number>("cursor_companion_interrupt", {
          expectedTurn: previous,
        })
      : previous;
    if (!this.active(previous)) return false;
    this.turn = next;
    await this.interrupt(cancelTask);
    // The Agents composer shares this mode; stop its typed invocation as well.
    if (cancelTask && this.active(next) && useMistyStore.getState().working)
      await useMistyStore.getState().cancelResponse?.();
    return this.active(next);
  };

  /** Finishes an owned typed turn once its response completes, pointing at what it names. */
  settle = () => {
    if (!this.owned || !this.invocationId || !this.active(this.submittedTurn)) return;
    const current = useMistyStore.getState();
    if (!current.working && current.error) {
      this.owned = false;
      this.fail(this.submittedTurn, current.error);
      return;
    }
    if (current.invocationId !== this.invocationId) return;
    if (current.working) return;
    this.owned = false;
    const reply = current.conversations
      .find((c) => c.id === this.submittedConversationId)
      ?.messages.slice()
      .reverse()
      .find((m) => m.role === "assistant");
    if (current.error || reply?.state !== "completed") {
      this.fail(
        this.submittedTurn,
        current.error || "The response stopped. Hold the shortcut to try again.",
      );
      return;
    }
    this.pointer.present(reply.content, this.invocationId);
    this.maybeHide();
  };

  /**
   * A Teach turn's screens plus a close-up of the region the last step pointed at,
   * so a check reads the person's work exactly. Without one, the screens alone.
   */
  withFocusCapture = async (screens: DisplayCapture[], generation: number) =>
    this.state.teach ? withLessonCloseUp(screens, generation, this.lastFocus) : screens;

  /** The screens, with Misty's own visible controls named on the one showing them. */
  capture = (generation: number, signal: AbortSignal) => captureScreens(generation, signal);
}

/** No selection means Misty's own agent; a prompt fills it in when it starts work. */
function orDefaultAgent(agentId: string | undefined) {
  return (
    agentId || usePersonalAgentsStore.getState().agents.find((agent) => agent.system_managed)?.id
  );
}
