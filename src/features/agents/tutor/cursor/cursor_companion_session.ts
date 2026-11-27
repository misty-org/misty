import { defaultEngineAgent, savedDefaultEngine } from "../../engines/default_engine";
import {
  effectiveValues,
  useDevicePreferences,
  writeDevicePreference,
} from "@/features/settings/preference_access";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { invoke } from "@tauri-apps/api/core";
import type { CompanionConversation } from "./companion_conversation";
import { normalizeCompanionSize } from "./companion_size";
import { cursorFace } from "./cursor_agent";
import { useCompanionState } from "./companion_state";
import { captureScreens, savedPresentation, withLessonCloseUp } from "./cursor_companion_screens";
import { CursorCompanionPointer } from "./cursor_companion_pointer";
import { CursorCompanionSketch } from "./cursor_companion_sketch";
import type { DisplayCapture, Presentation, PresentedFocus } from "./protocol";
import type { HandedFiles } from "./tutor_handed";
import { TutorTour } from "./tutor_tour";
import { useSettingsStore } from "@/features/settings";
import { voiceSettings } from "../../../voice/voice_settings";

export type CompanionOrigin = { conversationId: string; agentId?: string; tutor?: boolean };

export const tutorOrigin = (): CompanionOrigin => ({ conversationId: "", tutor: true });

const HINT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WAVE_MS = 1_800;

const hintText = () =>
  /Mac/.test(navigator.platform)
    ? "Hold ⌃ ⌥ to talk, or tap ⌃ twice to type"
    : "Hold Ctrl + Alt to talk, or tap Ctrl twice to type";

const ERROR_HOLD_MS = 8000;
const CANCEL_WAIT_MS = 5000;

export class CursorCompanionSession {
  disposed = false;
  turn = 0;
  owned = false;
  pointPending = false;
  voicePending = false;
  nativeReady = false;
  barrier: Promise<void> = Promise.resolve();
  abort: AbortController | undefined;
  conversationVoice: CompanionConversation | undefined;
  conversationScope: CompanionOrigin | undefined;
  creatingConversation = false;
  delegatedTask:
    | {
        id: string;
        conversationId: string;
        awaitingContinuation?: boolean;
        handoff?: { agentId: string; instruction: string; key: string };
      }
    | undefined;
  readonly pointer: CursorCompanionPointer = new CursorCompanionPointer(this);
  readonly sketch: CursorCompanionSketch = new CursorCompanionSketch(this);
  readonly tour: TutorTour = new TutorTour(this);
  toured = true;
  hideTimer: ReturnType<typeof setTimeout> | undefined;
  pointTimer: ReturnType<typeof setTimeout> | undefined;
  focusTimer: ReturnType<typeof setTimeout> | undefined;
  lastFocus: PresentedFocus | undefined;
  speechRetry: string | undefined;
  recordingOrigin: CompanionOrigin | undefined;
  state: Presentation;
  captures: DisplayCapture[] = [];
  recordedTurn = -1;
  submittedTurn = 0;
  invocationId: string | undefined;
  submittedConversationId: string | undefined;
  handed: HandedFiles | undefined;

  constructor(readonly accountId: string) {
    this.state = savedPresentation();
  }

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
      agent: cursorFace(),
      hint: hintFor(
        values["agents.companion.sprite"] !== false,
        String(values["agents.companion.hintSince"] ?? ""),
      ),
    });
    this.toured = values["agents.companion.toured"] === true;
    this.greet();
  };

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

  showFocus = (focus: PresentedFocus[], holdMs?: number) => {
    clearTimeout(this.focusTimer);
    if (!focus.length) return this.clearFocus();
    this.lastFocus = focus[0];
    this.change({ focus });
    const expected = this.turn;
    this.focusTimer = setTimeout(() => {
      if (this.active(expected)) this.clearFocus();
    }, holdMs ?? 60_000);
  };

  clearFocus = () => {
    clearTimeout(this.focusTimer);
    if (this.state.focus) this.change({ focus: undefined });
  };

  private presenting = () =>
    this.voicePending ||
    this.pointPending ||
    this.state.phase !== "idle" ||
    Boolean(this.state.focus || this.state.sketch || this.state.caption);

  private tip: string | undefined;
  private spoken: string | undefined;

  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  notice = (text: string, holdMs = 6_000) => {
    if (this.tour.running) return;
    this.setTip(text);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      if (!this.tour.running && this.tip === text) this.setTip(undefined);
    }, holdMs);
  };

  setTip = (tip?: string) => {
    this.tip = tip;
    this.showCaption();
  };

  onlyDisplay: number | undefined;

  captionNextAnswer = false;

  setSpoken = (sentence?: string) => {
    this.spoken = this.state.captions || this.captionNextAnswer ? sentence : undefined;
    if (sentence === undefined) this.captionNextAnswer = false;
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

  endNativeTurn = async (expected: number) => {
    try {
      return await invoke<number>("cursor_companion_interrupt", { expectedTurn: expected });
    } catch {
      return await invoke<number>("cursor_companion_interrupt", {});
    }
  };

  fail = (generation: number, reason: unknown) => {
    if (!this.active(generation)) return;
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
    if (cancelTask && this.active(next) && useMistyStore.getState().working)
      await useMistyStore.getState().cancelResponse?.();
    return this.active(next);
  };

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
    this.change({ phase: "idle" });
  };

  withFocusCapture = async (screens: DisplayCapture[], generation: number) =>
    this.state.teach ? withLessonCloseUp(screens, generation, this.lastFocus) : screens;

  capture = (generation: number, signal: AbortSignal) => captureScreens(generation, signal);
}

function orDefaultAgent(agentId: string | undefined) {
  return agentId || defaultEngineAgent(savedDefaultEngine());
}

function hintFor(sprite: boolean, since: string): Presentation["hint"] {
  if (!sprite) return undefined;
  if (!since) return { text: hintText(), first: true };
  const age = Date.now() - Date.parse(since);
  return age >= 0 && age < HINT_WEEK_MS ? { text: hintText(), first: false } : undefined;
}
