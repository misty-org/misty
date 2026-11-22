import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { voiceApi } from "./api";
import { insertIntoFocusedField } from "./insertText";
import { hear, type HearingSession } from "./speech";
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

/** Words heard in a dictation, kept as they arrive. */
interface Live {
  session: HearingSession;
  said: string[];
}

/**
 * Runs dictation in the main window: the native side reports the shortcut and sends the
 * microphone's audio and level; the audio goes into a hearing session (Misty's speech model on
 * this computer, no key), whose words keep the pill current, then this cleans up, routes or
 * inserts them.
 */
export class DictationController {
  private turn = 0;
  private live?: Promise<Live | undefined>;
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
      // The native side's microphone: its level drives the pill, and its audio is heard.
      listen<{ turn: number; pcm: string; power: number }>(
        "misty://dictation-audio",
        ({ payload }) => {
          if (payload.turn !== this.turn) return;
          this.show({ power: payload.power });
          const turn = payload.turn;
          void this.live?.then((live) => {
            if (live && turn === this.turn) live.session.push("mic", payload.pcm);
          });
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
    this.drop();
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
    this.drop();
    if (phase === "error") this.show({ phase: "notice", note: message || "Dictation stopped." });
    else void invoke("voice_dictation_pill_hide").catch(() => {});
  }

  /** Stops listening and throws away what was heard. */
  private drop() {
    const live = this.live;
    this.live = undefined;
    void live?.then((heard) => heard?.session.stop()).catch(() => undefined);
  }

  private async begin(turn: number) {
    this.turn = turn;
    this.drop();
    this.show({
      phase: "listening",
      text: "",
      provisional: "",
      power: 0,
      locked: false,
      note: undefined,
    });
    const said: string[] = [];
    const live = hear((event) => {
      if (turn !== this.turn) return;
      if (event.kind === "failed")
        return this.show({ phase: "notice", note: "Dictation stopped." });
      // Each pause brings what was said before it; while they speak, the level shows it.
      if (event.kind === "heard" && event.text.trim()) {
        said.push(event.text.trim());
        this.show({ text: said.join(" "), provisional: "" });
      }
    })
      .then((session): Live => ({ session, said }))
      .catch((error: unknown) => {
        if (turn === this.turn) {
          this.show({
            phase: "notice",
            note: error instanceof Error ? error.message : "Dictation couldn't start.",
          });
          void invoke("voice_dictation_stop").catch(() => {});
        }
        return undefined;
      });
    this.live = live;
  }

  private async end(turn: number) {
    const live = this.live;
    this.live = undefined;
    if (!live) return;
    this.show({ phase: "finishing" });
    const heard = await live
      .then(async (found) => {
        if (!found) return "";
        await found.session.stop().catch(() => undefined);
        return found.said.join(" ").trim();
      })
      .catch(() => "");
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
    else if (result.inserted === "not-allowed")
      this.show({ phase: "notice", note: "Misty didn’t type that, since you said not now." });
    else if (result.inserted === "keys-held")
      this.show({ phase: "notice", note: "Your words are on the clipboard." });
    else this.show({ phase: "done" });
  }
}
