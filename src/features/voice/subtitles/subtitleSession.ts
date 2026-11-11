import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { errorText } from "@/shared/lib/format";
import { voiceDeviceId } from "../api";
import { decodePcm } from "../capture/useCaptureStore";
import { LiveTranscriber, type LiveChannel } from "../liveTranscriber";
import { sonioxContext } from "./subtitleContext";
import { saveSubtitleSession } from "./savedSubtitles";
import { scalePcm } from "./subtitlePrefs";
import {
  channelFor,
  FINISH_TIMEOUT_MS,
  SEGMENTS_SHOWN,
  heardText,
  savedLines,
  type Host,
} from "./subtitleSessionHost";

/**
 * One listening session: this computer's sound or microphone through the live relay, with the
 * panel's volume and auto-stop applied here. It runs in the window that opened the panel. Soniox
 * takes its context once, when the stream starts, so what the person wrote in Context is what it
 * gets; nothing reads the page unless they ask.
 */
export class SubtitleSession {
  private live?: LiveTranscriber;
  private sessions = new Set<number>();
  private nativeOpen = false;
  private unlisten: Promise<UnlistenFn>[] = [];
  private lastSound = Date.now();
  private startedAt = new Date().toISOString();
  private over = false;
  private stopping = false;

  constructor(private readonly host: Host) {}

  async start() {
    this.unlisten.push(
      listen<{ session: number; channel: LiveChannel; power: number; pcm: string }>(
        "misty://capture-audio",
        ({ payload }) => this.onAudio(payload),
      ),
      listen<{ session: number; error?: string; notice?: string }>(
        "misty://capture-state",
        ({ payload }) => {
          const notice = payload.error || payload.notice;
          if (this.sessions.has(payload.session) && notice) this.host.draw({ notice });
        },
      ),
    );
    try {
      await voiceDeviceId();
      // What's said while the relay answers is held for the stream.
      this.live = this.transcriber();
      await this.openAudio();
      if (this.over) return;
      await this.connect(this.live);
      if (this.over) return;
      this.host.draw({ status: "live" });
    } catch (error) {
      if (!this.over) await this.finish(errorText(error) || "Subtitles couldn't start.");
    }
  }

  /** Stops listening, waits for the last words, and keeps the session if asked. */
  async stop(notice?: string) {
    if (this.over || this.stopping) return;
    this.stopping = true;
    this.host.draw({ status: "stopping" });
    await this.closeAudio();
    await this.live?.finish(FINISH_TIMEOUT_MS);
    await this.finish(notice);
  }

  /** Something else has taken the audio over, so there's nothing to close. */
  abandon(notice: string) {
    this.nativeOpen = false;
    void this.finish(notice);
  }

  private async finish(notice?: string) {
    if (this.over) return;
    this.over = true;
    this.live?.close();
    await this.closeAudio();
    for (const remove of this.unlisten) void remove.then((fn) => fn());
    this.keep();
    this.host.ended(notice);
  }

  private transcriber(): LiveTranscriber {
    const live: LiveTranscriber = new LiveTranscriber({
      onChange: () => {
        if (!this.over) this.host.draw(this.heard());
      },
      // The relay says this when it's reached its limit or lost Soniox: the session is over.
      onNotice: (notice) => {
        if (this.live === live) void this.finish(notice);
      },
      onClosed: () => {
        if (this.live === live && !this.stopping)
          void this.finish("Subtitles stopped. Check your connection, then try again.");
      },
    });
    return live;
  }

  private connect(live: LiveTranscriber) {
    const prefs = this.host.prefs();
    const language = prefs.source;
    const target = prefs.mode === "translate" ? prefs.target : language;
    return live.connect(
      { channels: [channelFor(prefs.input)], language },
      { language, target, context: sonioxContext(prefs.context) },
    );
  }

  /** Opens this computer's sound, or its microphone. A refusal reaches the person as it is. */
  private async openAudio() {
    const mic = this.host.prefs().input === "mic";
    this.nativeOpen = true;
    try {
      const id = await invoke<number>("voice_capture_start", {
        // Videos play inside Misty, so Misty's own sound is part of what it hears.
        request: { mic, system: !mic, includeMisty: !mic },
      });
      this.sessions.add(id);
      this.lastSound = Date.now();
      if (this.over) await this.closeAudio();
    } catch (error) {
      this.nativeOpen = false;
      throw error;
    }
  }

  private segments(limit: number) {
    return this.live ? this.live.transcript.latest(limit).slice(-limit) : [];
  }

  private heard() {
    return heardText(this.segments(SEGMENTS_SHOWN), this.host.prefs().target);
  }

  private async closeAudio() {
    if (!this.nativeOpen) return;
    this.nativeOpen = false;
    await invoke("voice_capture_stop").catch(() => undefined);
  }

  private keep() {
    if (!this.host.prefs().save || !this.live) return;
    const lines = savedLines(this.segments(Number.MAX_SAFE_INTEGER));
    const last = lines[lines.length - 1];
    saveSubtitleSession({
      id: `${this.startedAt}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: this.startedAt,
      preview: (last?.translation || last?.source || "").slice(0, 180),
      lines,
    });
  }

  private onAudio(payload: { session: number; channel: LiveChannel; power: number; pcm: string }) {
    if (!this.sessions.has(payload.session) || this.over) return;
    const prefs = this.host.prefs();
    const gain = prefs.muted ? 0 : prefs.gain;
    this.live?.push(payload.channel, scalePcm(decodePcm(payload.pcm), gain));
    const now = Date.now();
    if (payload.power * gain > 10 ** (prefs.silenceDbfs / 20)) this.lastSound = now;
    else if (now - this.lastSound > prefs.silenceSeconds * 1000)
      void this.stop(`Stopped after ${prefs.silenceSeconds} seconds of silence.`);
  }
}
