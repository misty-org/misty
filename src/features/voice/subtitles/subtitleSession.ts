import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { errorText } from "@/shared/lib/format";
import { voiceApi, voiceDeviceId } from "../api";
import { decodePcm } from "../capture/useCaptureStore";
import { LiveTranscriber, type LiveChannel } from "../liveTranscriber";
import type { Transcript } from "../transcript/transcript";
import { sonioxContext } from "./subtitleContext";
import { saveSubtitleSession } from "./savedSubtitles";
import { scalePcm } from "./subtitlePrefs";
import type { SubtitlePrefs, SubtitlesView } from "./subtitlesView";

/** More than the window can show, so the words always fill it. */
const SEGMENTS_SHOWN = 12;
const FINISH_TIMEOUT_MS = 3000;

export interface CaptureSources {
  microphone: string;
  applications: { name: string; pids: number[] }[];
}

function heard(transcript: Transcript, target: string) {
  const segments = transcript.latest(SEGMENTS_SHOWN);
  // These languages don't put spaces between sentences.
  const gap = /^(zh|ja)/i.test(target) ? "" : " ";
  return {
    source: segments
      .map((segment) => segment.sourceText.trim())
      .filter(Boolean)
      .join(" "),
    translation: segments
      .map((segment) => segment.translatedText.trim())
      .filter(Boolean)
      .join(gap),
  };
}

interface Host {
  prefs(): SubtitlePrefs;
  draw(next: Partial<SubtitlesView>): void;
  /** The session finished or failed, with what to tell the person. */
  ended(notice?: string): void;
}

/**
 * One listening session: audio from this computer through the live relay, with the panel's volume
 * and auto-stop applied here. It runs in the window that opened the panel.
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
    const prefs = this.host.prefs();
    const language = prefs.source;
    const target = prefs.mode === "translate" ? prefs.target : language;
    const channel: LiveChannel = prefs.input;
    const live = new LiveTranscriber({
      onChange: (transcript) => {
        if (!this.over) this.host.draw(heard(transcript, target));
      },
      // The relay says this when it's reached its limit or lost Soniox: the session is over.
      onNotice: (notice) => void this.finish(notice),
      onClosed: () => {
        if (!this.stopping)
          void this.finish("Subtitles stopped. Check your connection, then try again.");
      },
    });
    this.live = live;
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
      const pids = await this.appPids(prefs);
      const device = await voiceDeviceId();
      const ticket = await voiceApi.liveTicket({
        device_id: device,
        channels: [channel],
        language,
      });
      if (this.over) return;
      this.nativeOpen = true;
      const id = await invoke<number>("voice_capture_start", {
        request: {
          mic: channel === "mic",
          system: channel === "system" && !pids.length,
          includeMisty: true,
          pids,
        },
      });
      this.sessions.add(id);
      this.lastSound = Date.now();
      if (this.over) {
        await invoke("voice_capture_stop");
        return;
      }
      await live.connect(ticket.url, ticket.ticket, {
        language,
        target,
        context: sonioxContext(prefs.context),
      });
      if (!this.over) this.host.draw({ status: "live" });
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

  private async closeAudio() {
    if (!this.nativeOpen) return;
    this.nativeOpen = false;
    await invoke("voice_capture_stop").catch(() => undefined);
  }

  private keep() {
    const prefs = this.host.prefs();
    if (!prefs.save || !this.live) return;
    const lines = this.live.transcript
      .latest(Number.MAX_SAFE_INTEGER)
      .map((segment) => ({
        source: segment.sourceText.trim(),
        translation: segment.translatedText.trim(),
      }))
      .filter((line) => line.source || line.translation);
    const last = lines[lines.length - 1];
    saveSubtitleSession({
      id: `${this.startedAt}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: this.startedAt,
      preview: (last?.translation || last?.source || "").slice(0, 180),
      lines,
    });
  }

  private async appPids(prefs: SubtitlePrefs) {
    if (prefs.input !== "system" || !prefs.app) return [];
    const sources = await invoke<CaptureSources>("voice_capture_sources");
    const pids = sources.applications.find((app) => app.name === prefs.app)?.pids ?? [];
    if (!pids.length) throw new Error(`${prefs.app} isn't playing anything right now.`);
    return pids;
  }

  private onAudio(payload: { session: number; channel: LiveChannel; power: number; pcm: string }) {
    if (!this.sessions.has(payload.session) || this.over) return;
    const prefs = this.host.prefs();
    const mic = payload.channel === "mic";
    const muted = mic ? prefs.micMuted : prefs.desktopMuted;
    const gain = muted ? 0 : mic ? prefs.micGain : prefs.desktopGain;
    this.live?.push(payload.channel, scalePcm(decodePcm(payload.pcm), gain));
    const now = Date.now();
    if (payload.power * gain > 10 ** (prefs.silenceDbfs / 20)) this.lastSound = now;
    else if (now - this.lastSound > prefs.silenceSeconds * 1000)
      void this.stop(`Stopped after ${prefs.silenceSeconds} seconds of silence.`);
  }
}
