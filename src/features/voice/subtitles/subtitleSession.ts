import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { errorText } from "@/shared/lib/format";
import { voiceDeviceId } from "../api";
import { decodePcm } from "../capture/useCaptureStore";
import { LiveTranscriber, type LiveChannel } from "../liveTranscriber";
import { sonioxContext, withPage, type PageContext } from "./subtitleContext";
import { currentPage, pageKey, readPage, type CurrentPage } from "./subtitlePage";
import { saveSubtitleSession } from "./savedSubtitles";
import { scalePcm } from "./subtitlePrefs";
import type { SubtitlePrefs, SubtitlesView } from "./subtitlesView";

/** More than the window can show, so the words always fill it. */
const SEGMENTS_SHOWN = 12;
const FINISH_TIMEOUT_MS = 3000;
/** Subtitles don't wait longer than this for the model; its answer is used when it comes. */
const CONTEXT_WAIT_MS = 6000;
const AUDIO_RETRY_MS = 1000;
const PAGE_CHECK_MS = 3000;
/** A page that redirects twice shouldn't restart the stream twice. */
const PAGE_CHANGE_GAP_MS = 15_000;
const CHANNEL: LiveChannel = "system";
/** `voice_capture_start`'s answer when no tab has made a sound yet. */
const TABS_SILENT = "misty_tabs_silent";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Host {
  prefs(): SubtitlePrefs;
  draw(next: Partial<SubtitlesView>): void;
  /** The session finished or failed, with what to tell the person. */
  ended(notice?: string): void;
}

/**
 * One listening session: Misty's tabs through the live relay, with the panel's volume and auto-stop
 * applied here. It runs in the window that opened the panel. Soniox takes its context once, when a
 * stream starts, so a new page gets a new stream, and the words of the last one stay on screen.
 */
export class SubtitleSession {
  private live?: LiveTranscriber;
  private past: LiveTranscriber[] = [];
  private sessions = new Set<number>();
  private nativeOpen = false;
  private unlisten: Promise<UnlistenFn>[] = [];
  private lastSound = Date.now();
  private startedAt = new Date().toISOString();
  private over = false;
  private stopping = false;
  private connected = false;
  /** One model call per page, whatever happens to the streams. */
  private pages = new Map<string, Promise<PageContext | undefined>>();
  private pageTimer?: ReturnType<typeof setInterval>;
  /** The page this stream's context came from, and the one last seen in front. */
  private streamPage?: string;
  private seenPage?: string;
  private changing = false;
  private changedAt = 0;

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
      // What's said while the model and the relay answer is held for the stream.
      this.live = this.transcriber();
      const page = currentPage();
      const pageKnown = page && this.pageContext(page);
      if (!(await this.openAudio())) return;
      const first = await this.contextSoon(pageKnown);
      if (this.over) return;
      this.streamPage = page && pageKey(page);
      this.seenPage = this.streamPage;
      this.changedAt = Date.now();
      await this.connect(this.live, first);
      this.connected = true;
      if (this.over) return;
      this.host.draw({ status: "live", pageTopic: first?.topic || undefined });
      this.pageTimer = setInterval(() => this.checkPage(), PAGE_CHECK_MS);
      // The model was slower than the wait: this stream gets what it found after all.
      if (page && pageKnown && !first) void this.useLateContext(page, pageKnown);
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
    clearInterval(this.pageTimer);
    this.live?.close();
    for (const earlier of this.past) earlier.close();
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

  private connect(live: LiveTranscriber, page: PageContext | undefined) {
    const prefs = this.host.prefs();
    const language = prefs.source;
    const target = prefs.mode === "translate" ? prefs.target : language;
    return live.connect(
      { channels: [CHANNEL], language },
      { language, target, context: sonioxContext(withPage(prefs.context, page)) },
    );
  }

  /**
   * Misty's tabs have no audio to listen to until one has played something, so this keeps trying,
   * as long as auto-stop would wait for sound. Stop works in the meantime.
   */
  private async openAudio() {
    const since = Date.now();
    for (;;) {
      if (this.over || this.stopping) return false;
      this.nativeOpen = true;
      try {
        const id = await invoke<number>("voice_capture_start", {
          request: { mic: false, system: false, mistyOnly: true },
        });
        this.sessions.add(id);
        this.lastSound = Date.now();
        if (this.over) {
          await invoke("voice_capture_stop");
          return false;
        }
        return true;
      } catch (error) {
        this.nativeOpen = false;
        if (errorText(error) !== TABS_SILENT) throw error;
      }
      const { silenceSeconds } = this.host.prefs();
      if (Date.now() - since > silenceSeconds * 1000) {
        void this.stop(`Stopped after ${silenceSeconds} seconds of silence.`);
        return false;
      }
      this.host.draw({ status: "live", notice: "Play something in a tab to see its subtitles." });
      await pause(AUDIO_RETRY_MS);
    }
  }

  private pageContext(page: CurrentPage) {
    const key = pageKey(page);
    let known = this.pages.get(key);
    if (!known) {
      const { source, mode, target } = this.host.prefs();
      known = readPage(page, source, mode === "translate" ? target : source).catch((error) => {
        // Subtitles work without it, but the person should know why names come out wrong.
        if (!this.over)
          this.host.draw({ notice: `Subtitles couldn't read this page. ${errorText(error)}` });
        return undefined;
      });
      this.pages.set(key, known);
    }
    return known;
  }

  private contextSoon(known: Promise<PageContext | undefined> | undefined) {
    if (!known) return Promise.resolve(undefined);
    return Promise.race([known, pause(CONTEXT_WAIT_MS).then(() => undefined)]);
  }

  private async useLateContext(page: CurrentPage, known: Promise<PageContext | undefined>) {
    const context = await known;
    if (context && this.streamPage === pageKey(page) && !this.changing)
      await this.changeStream(pageKey(page), context);
  }

  private checkPage() {
    if (this.over || this.stopping || this.changing) return;
    const page = currentPage();
    // Settings or a chat in front isn't a new page; the page that's playing is still the same.
    if (!page) return;
    const key = pageKey(page);
    const settled = key === this.seenPage;
    this.seenPage = key;
    if (!settled || key === this.streamPage) return;
    if (Date.now() - this.changedAt < PAGE_CHANGE_GAP_MS) return;
    void this.moveToPage(page, key);
  }

  private async moveToPage(page: CurrentPage, key: string) {
    this.changing = true;
    try {
      const context = await this.pageContext(page);
      // With nothing new to say about this page, the stream that's running is as good as a new one.
      if (context) await this.changeStream(key, context);
      else this.streamPage = key;
    } finally {
      this.changing = false;
    }
  }

  /** The old stream runs until the new one is listening, then finishes its last words. */
  private async changeStream(key: string, context: PageContext) {
    if (this.over || this.stopping) return;
    const next = this.transcriber();
    try {
      await this.connect(next, context);
    } catch {
      // The stream that's running still works, just without this page's context.
      next.close();
      return;
    }
    if (this.over || this.stopping) return next.close();
    const previous = this.live;
    this.live = next;
    this.streamPage = key;
    this.changedAt = Date.now();
    if (previous) {
      this.past.push(previous);
      void previous.finish(FINISH_TIMEOUT_MS);
    }
    this.host.draw({ pageTopic: context.topic || undefined });
  }

  private segments(limit: number) {
    const streams = [...this.past, ...(this.live ? [this.live] : [])];
    return streams.flatMap((stream) => stream.transcript.latest(limit)).slice(-limit);
  }

  private heard() {
    const segments = this.segments(SEGMENTS_SHOWN);
    // These languages don't put spaces between sentences.
    const gap = /^(zh|ja)/i.test(this.host.prefs().target) ? "" : " ";
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

  private async closeAudio() {
    if (!this.nativeOpen) return;
    this.nativeOpen = false;
    await invoke("voice_capture_stop").catch(() => undefined);
  }

  private keep() {
    if (!this.host.prefs().save || !this.live) return;
    const lines = this.segments(Number.MAX_SAFE_INTEGER)
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
