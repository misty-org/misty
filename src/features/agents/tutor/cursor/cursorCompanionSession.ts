import { defaultEngineAgent, savedDefaultEngine } from "../../engines/defaultEngine";
import {
  effectiveValues,
  useDevicePreferences,
  writeDevicePreference,
} from "@/features/settings/preferenceAccess";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import { invoke } from "@tauri-apps/api/core";
import type { CompanionConversation } from "./companionConversation";
import { normalizeCompanionSize } from "./companionSize";
import { useCompanionState } from "./companionState";
import { captureScreens, savedPresentation, withLessonCloseUp } from "./cursorCompanionScreens";
import { CursorCompanionPointer } from "./cursorCompanionPointer";
import { CursorCompanionSketch } from "./cursorCompanionSketch";
import type { DisplayCapture, Presentation, PresentedFocus } from "./protocol";
import type { HandedFiles } from "./tutorHanded";
import { TutorTour } from "./tutorTour";
import { useSettingsStore } from "@/features/settings";
import { voiceSettings } from "../../../voice/voiceSettings";

/**
 * Where a companion turn belongs. `tutor` is Tutor's own conversation (`tutorConversation.ts`),
 * which stays current whatever chat the window shows; otherwise it is the open chat (a lesson,
 * in Teach mode), and the turn is stale once another opens.
 */
export type CompanionOrigin = { conversationId: string; agentId?: string; tutor?: boolean };

/** Tutor's own conversation, as an origin; its id is filled in once it is opened. */
export const tutorOrigin = (): CompanionOrigin => ({ conversationId: "", tutor: true });

/** How long Misty says her shortcuts beside the pointer: her first week. */
const HINT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** How long she waves hello before the tour's first step. */
const WAVE_MS = 1_800;

/** The shortcuts as Misty says them beside the pointer. */
const hintText = () =>
  /Mac/.test(navigator.platform)
    ? "Hold ⌃ ⌥ to talk, or tap ⌃ twice to type"
    : "Hold Ctrl + Alt to talk, or tap Ctrl twice to type";

/** How long a failure stays at the cursor; Agents keeps it, with Retry. */
const ERROR_HOLD_MS = 8000;
/** How long a new turn waits for the last one's task to be canceled. */
const CANCEL_WAIT_MS = 5000;

/**
 * One signed-in account's cursor companion: its presentation, turn ownership,
 * interruption and pointing. Voice, typed turns and native events share it.
 * The overlay shows only for what the talk shortcut started; otherwise it stays hidden.
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
  delegatedTask:
    | {
        id: string;
        conversationId: string;
        awaitingContinuation?: boolean;
        /** A hand-off's agent, its words and key, so "no, Ada" can give it to another agent. */
        handoff?: { agentId: string; instruction: string; key: string };
      }
    | undefined;
  /** Pointing and walkthrough steps for finished replies. */
  readonly pointer: CursorCompanionPointer = new CursorCompanionPointer(this);
  /** A reply's drawing, drawn while it streams. */
  readonly sketch: CursorCompanionSketch = new CursorCompanionSketch(this);
  readonly tour: TutorTour = new TutorTour(this);
  /** Whether the tour has been taken (or started) on this device. */
  toured = true;
  hideTimer: ReturnType<typeof setTimeout> | undefined;
  pointTimer: ReturnType<typeof setTimeout> | undefined;
  focusTimer: ReturnType<typeof setTimeout> | undefined;
  /** The region the last lesson step pointed at; the next check captures it close up. */
  lastFocus: PresentedFocus | undefined;
  speechRetry: string | undefined;
  recordingOrigin: CompanionOrigin | undefined;
  state: Presentation;
  captures: DisplayCapture[] = [];
  recordedTurn = -1;
  submittedTurn = 0;
  invocationId: string | undefined;
  submittedConversationId: string | undefined;
  /** Files dropped on Misty, waiting for the next turn (`tutorHanded.ts`). */
  handed: HandedFiles | undefined;

  constructor(readonly accountId: string) {
    this.state = savedPresentation();
  }

  /** Where a turn starting now belongs: Tutor's own conversation, or in Teach mode the open lesson. */
  turnOrigin = (): CompanionOrigin => {
    if (!this.state.teach) return tutorOrigin();
    const current = useMistyStore.getState();
    return { conversationId: current.activeConversationId, agentId: current.selectedAgentId };
  };

  originIsCurrent = (origin: CompanionOrigin) => {
    const current = useMistyStore.getState();
    if (origin.tutor) return current.accountId === this.accountId;
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
    };
    this.publish();
    // Every way a turn ends comes through here, so none of them can leave the overlay up.
    if (this.state.visible) this.maybeHide();
  };

  applyPreferences = () => {
    const settings = useDevicePreferences.getState();
    if (!settings.state) return;
    const values = effectiveValues(settings.state);
    this.change({
      size: normalizeCompanionSize(values["agents.companion.size"]),
      ask: values["agents.companion.ask"] === true,
      teach: values["agents.companion.teach"] === true,
      captions: values["agents.companion.captions"] === true,
      tint: String(values["agents.companion.tint"] ?? "white"),
      sprite: values["agents.companion.sprite"] !== false,
      hint: hintFor(
        values["agents.companion.sprite"] !== false,
        String(values["agents.companion.hintSince"] ?? ""),
      ),
    });
    this.toured = values["agents.companion.toured"] === true;
    this.greet();
  };

  /**
   * Misty's first appearance on this device: she says her shortcuts beside the pointer (and
   * keeps saying them on a resting pointer for a week), and someone who hasn't taken the tour is
   * waved at and walked through it.
   */
  greet = () => {
    if (!this.nativeReady || this.disposed || !this.state.sprite) return;
    const settings = useDevicePreferences.getState().state;
    if (!settings) return;
    if (!String(effectiveValues(settings)["agents.companion.hintSince"] ?? ""))
      void writeDevicePreference("agents.companion.hintSince", new Date().toISOString()).catch(
        () => undefined,
      );
    if (this.toured || !savedDefaultEngine()) return;
    this.toured = true;
    this.change({ wave: true });
    setTimeout(() => {
      if (this.disposed) return;
      this.change({ wave: false });
      if (!this.tour.running) this.tour.start(0);
    }, WAVE_MS);
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

  /** Something is still on screen for this turn: hiding the overlay would cut it off. */
  private presenting = () =>
    this.voicePending ||
    this.pointPending ||
    this.state.phase !== "idle" ||
    Boolean(this.state.focus || this.state.sketch || this.state.caption);

  /** The tour's line, shown at the bottom whenever Misty isn't talking. */
  private tip: string | undefined;
  /** The sentence being said, shown at the bottom while captions are on. */
  private spoken: string | undefined;

  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** A short line at the bottom of the screen for a moment, such as where an unheard answer went. */
  notice = (text: string, holdMs = 6_000) => {
    if (this.tour.running) return;
    this.setTip(text);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      if (!this.tour.running && this.tip === text) this.setTip(undefined);
    }, holdMs);
  };

  /** Shows the tour's next ask at the bottom of the screen, or clears it. */
  setTip = (tip?: string) => {
    this.tip = tip;
    this.showCaption();
  };

  /** The one display Tutor looks at, after "only this monitor"; every display when unset. */
  onlyDisplay: number | undefined;

  /** A typed question's answer is captioned whatever the setting, as a chat would show it. */
  captionNextAnswer = false;

  /** The sentence the voice is on now, for captions; undefined once it stops. */
  setSpoken = (sentence?: string) => {
    this.spoken = this.state.captions || this.captionNextAnswer ? sentence : undefined;
    if (sentence === undefined) this.captionNextAnswer = false;
    // Misty bobs with each word as it's said, at the voice's own pace.
    const count = sentence?.trim().split(/\s+/).filter(Boolean).length ?? 0;
    const rate = voiceSettings(useSettingsStore.getState().settings?.document).speakingRate;
    this.state = {
      ...this.state,
      words: count
        ? { count, rate: Number.isFinite(rate) && rate > 0 ? rate : 1, at: Date.now() }
        : undefined,
    };
    this.showCaption();
  };

  private showCaption = () => {
    const text = this.spoken ?? this.tip;
    this.change({
      caption: text ? { text, ...(this.spoken ? {} : { tip: true }) } : undefined,
      ...(text ? { visible: true } : {}),
    });
  };

  /** Hides the cursor once the turn has nothing left to show. */
  maybeHide = () => {
    if (this.presenting()) return;
    const expected = this.turn;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(
      () => {
        if (this.active(expected) && !this.presenting()) this.change({ visible: false });
      },
      this.state.error ? ERROR_HOLD_MS : 1000,
    );
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
    // A cancel that never settles is waited for only so long, so it can't hold every later turn.
    this.barrier = this.barrier
      .catch(() => {})
      .then(async () => {
        if (shouldCancel && !this.disposed && useMistyStore.getState().accountId === this.accountId)
          await Promise.race([
            useMistyStore.getState().cancelResponse?.(),
            new Promise((settled) => setTimeout(settled, CANCEL_WAIT_MS)),
          ]);
      });
    return this.barrier;
  };

  /**
   * Ends the native turn this window knows. When the native side has moved on without this window
   * hearing of it (a question from the text box sent to another window), the current turn is ended
   * instead: the person is starting something new, and a refusal here would refuse every try
   * after it.
   */
  endNativeTurn = async (expected: number) => {
    try {
      return await invoke<number>("cursor_companion_interrupt", { expectedTurn: expected });
    } catch {
      return await invoke<number>("cursor_companion_interrupt", {});
    }
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
    const next = this.nativeReady ? await this.endNativeTurn(previous) : previous;
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
    // A typed turn's answer is in its chat; only a spoken one points at the screen.
    this.change({ phase: "idle" });
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

/** No selection means the default engine's agent; a prompt fills it in when it starts work. */
function orDefaultAgent(agentId: string | undefined) {
  return agentId || defaultEngineAgent(savedDefaultEngine());
}

/** The shortcut hint beside Misty: while she shows, from her first appearance for a week. */
function hintFor(sprite: boolean, since: string): Presentation["hint"] {
  if (!sprite) return undefined;
  if (!since) return { text: hintText(), first: true };
  const age = Date.now() - Date.parse(since);
  return age >= 0 && age < HINT_WEEK_MS ? { text: hintText(), first: false } : undefined;
}
