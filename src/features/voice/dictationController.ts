import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { voiceApi, voiceDeviceId } from "./api";
import { insertIntoFocusedField } from "./insertText";
import { LiveTranscriber } from "./liveTranscriber";
import type { VoiceSettings } from "./voiceSettings";
import { findVocative, routeToAgent } from "./vocativeRoute";

/** What the pill shows; sent to the pill window as it changes. */
export interface PillState {
  phase: "listening" | "finishing" | "done" | "notice";
  text: string;
  /** The not-yet-confirmed tail, drawn dimmed. */
  provisional: string;
  power: number;
  locked: boolean;
  /** Where the words went, or a plain-language problem. */
  note?: string;
}

type NativePhase = "start" | "lock" | "finish" | "cancel" | "error";
const PILL = "misty-dictation-pill";
/** Cleanup is skipped for a word or two: nothing to tidy. */
const CLEANUP_MIN_WORDS = 3;

function decode(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Runs dictation in the main window: the native side reports the shortcut
 * and streams microphone audio; this opens the live relay, keeps the pill
 * current, then cleans up, routes or inserts the words.
 */
export class DictationController {
  private turn = 0;
  private live?: LiveTranscriber;
  private pill: PillState = {
    phase: "listening",
    text: "",
    provisional: "",
    power: 0,
    locked: false,
  };
  private removers: Promise<UnlistenFn>[] = [];

  constructor(private settings: VoiceSettings) {}

  start() {
    this.removers.push(
      listen<{ turn: number; phase: NativePhase; message?: string }>(
        "misty://dictation",
        ({ payload }) => void this.onPhase(payload.turn, payload.phase, payload.message),
      ),
      listen<{ turn: number; pcm: string; power: number }>(
        "misty://dictation-audio",
        ({ payload }) => {
          if (payload.turn !== this.turn) return;
          this.live?.push("mic", decode(payload.pcm));
          this.show({ power: payload.power });
        },
      ),
      listen(
        "misty://dictation-pill-stop",
        () => void invoke("voice_dictation_stop").catch(() => {}),
      ),
    );
    return this.configure(this.settings);
  }

  configure(settings: VoiceSettings) {
    this.settings = settings;
    return invoke("voice_dictation_configure", {
      enabled: settings.dictation,
      chord: settings.shortcut || null,
      handsFree: settings.handsFree,
    });
  }

  dispose() {
    this.live?.close();
    for (const remove of this.removers) void remove.then((fn) => fn());
    void invoke("voice_dictation_configure", {
      enabled: false,
      chord: null,
      handsFree: false,
    }).catch(() => {});
  }

  private hideTimer?: ReturnType<typeof setTimeout>;

  private show(change: Partial<PillState>) {
    this.pill = { ...this.pill, ...change };
    void emitTo(PILL, "misty://dictation-pill", this.pill).catch(() => {});
    clearTimeout(this.hideTimer);
    // Where the words went, or why not, stays readable for a moment.
    if (this.pill.phase === "done" || this.pill.phase === "notice")
      this.hideTimer = setTimeout(
        () => void invoke("voice_dictation_pill_hide").catch(() => {}),
        this.pill.phase === "notice" ? 4000 : 1400,
      );
  }

  private async onPhase(turn: number, phase: NativePhase, message?: string) {
    if (phase === "start") return this.begin(turn);
    if (turn !== this.turn) return;
    if (phase === "lock") return this.show({ locked: true });
    if (phase === "finish") return this.end(turn);
    this.live?.close();
    this.live = undefined;
    if (phase === "error") this.show({ phase: "notice", note: message || "Dictation stopped." });
    else void invoke("voice_dictation_pill_hide").catch(() => {});
  }

  private async begin(turn: number) {
    this.turn = turn;
    this.live?.close();
    this.show({
      phase: "listening",
      text: "",
      provisional: "",
      power: 0,
      locked: false,
      note: undefined,
    });
    const live = new LiveTranscriber({
      onChange: (transcript) => {
        const segments = transcript.segments();
        this.show({
          text: segments
            .filter((s) => s.final)
            .map((s) => s.sourceText.trim())
            .join(" "),
          provisional: segments
            .filter((s) => !s.final)
            .map((s) => s.sourceText.trim())
            .join(" "),
        });
      },
      onNotice: (note) => this.show({ phase: "notice", note }),
    });
    this.live = live;
    try {
      // The microphone is already open; its audio waits in the transcriber
      // while the ticket and socket open, so the first words are kept.
      const device = await voiceDeviceId();
      const ticket = await voiceApi.liveTicket({
        device_id: device,
        channels: ["mic"],
        language: this.settings.language,
      });
      if (turn !== this.turn) return;
      await live.connect(ticket.url, ticket.ticket, {
        language: this.settings.language,
        context: this.settings.dictionary.length ? { terms: this.settings.dictionary } : undefined,
      });
    } catch (error) {
      if (turn !== this.turn) return;
      live.close();
      this.show({
        phase: "notice",
        note: error instanceof Error ? error.message : "Dictation couldn't start.",
      });
      void invoke("voice_dictation_stop").catch(() => {});
    }
  }

  private async end(turn: number) {
    const live = this.live;
    if (!live) return;
    this.show({ phase: "finishing" });
    const heard = await live.finish();
    if (turn !== this.turn) return;
    if (!heard) return this.show({ phase: "notice", note: "Didn't catch anything." });
    const vocative = this.settings.agentHandoff ? findVocative(heard) : null;
    if (vocative) {
      try {
        await routeToAgent(vocative);
        this.show({ phase: "done", note: `Sent to ${vocative.agent.name}` });
      } catch (error) {
        this.show({
          phase: "notice",
          note: error instanceof Error ? error.message : "That agent couldn't take it.",
        });
      }
      return;
    }
    const text = await this.clean(heard);
    await this.insert(text);
  }

  private async clean(text: string) {
    if (!this.settings.cleanup || text.split(/\s+/).length < CLEANUP_MIN_WORDS) return text;
    try {
      const result = await voiceApi.cleanup({
        text,
        style: this.settings.style,
        dictionary: this.settings.dictionary,
        language: this.settings.language,
      });
      return result.text || text;
    } catch {
      // Cleanup is a nicety; the words as heard are still right.
      return text;
    }
  }

  private async insert(text: string) {
    const result = await invoke<{ inserted: string }>("voice_dictation_insert", {
      text,
      force: false,
    });
    if (result.inserted === "misty" && !insertIntoFocusedField(text)) {
      // A web page in a tab has focus: paste into it like any other app.
      await invoke("voice_dictation_insert", { text, force: true });
    }
    if (result.inserted === "clipboard")
      this.show({
        phase: "notice",
        note: "Allow Accessibility so Misty can paste for you. Your words are on the clipboard.",
      });
    else if (result.inserted === "keys-held")
      this.show({ phase: "notice", note: "Your words are on the clipboard." });
    else this.show({ phase: "done" });
  }
}
