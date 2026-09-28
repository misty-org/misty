import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { voiceApi, voiceDeviceId } from "../api";
import { LiveTranscriber, type LiveChannel } from "../liveTranscriber";
import { captureApi, type VoiceNoteMode, type VoiceSourceKind, type VoiceTurn } from "./captureApi";
import { savedTurns } from "./transcriptTurns";

/** What to listen to. A tab is heard through the page itself. */
export interface CaptureSource {
  kind: Exclude<VoiceSourceKind, "library_item">;
  title: string;
  url?: string;
  /** The tab's browser runtime id, for kind "tab". */
  tabId?: string;
  /** Processes to hear, for kind "app". */
  pids?: number[];
  /** Also hear the person, on its own channel. */
  mic: boolean;
}

type Phase = "idle" | "starting" | "live" | "saving" | "done" | "working";

interface CaptureStore {
  phase: Phase;
  title: string;
  source?: CaptureSource;
  muted: boolean;
  turns: VoiceTurn[];
  speakers: Record<string, string>;
  /** What the person typed while listening. */
  notes: string;
  transcriptId?: string;
  noteId?: string;
  noteSpaceId?: string;
  notice?: string;
  start(source: CaptureSource, language: string): Promise<void>;
  toggleMute(): Promise<void>;
  stop(): Promise<void>;
  rename(speaker: string, name: string): void;
  setNotes(notes: string): void;
  makeNote(mode: VoiceNoteMode): Promise<void>;
  /** Shows a transcript that is already saved, such as a transcribed file. */
  show(transcript: {
    id: string;
    title: string;
    turns: VoiceTurn[];
    speakers: Record<string, string>;
  }): void;
  close(): void;
}

interface Running {
  live: LiveTranscriber;
  sessions: Set<number>;
  native: boolean;
  tabId?: string;
  startedAt: number;
  language: string;
  unlisten: Promise<UnlistenFn>[];
}

let running: Running | undefined;

function decode(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

async function release(current: Running) {
  await Promise.allSettled([
    current.native ? invoke("voice_capture_stop") : undefined,
    current.tabId ? invoke("voice_tab_capture_stop", { id: current.tabId }) : undefined,
  ]);
  for (const remove of current.unlisten) void remove.then((fn) => fn());
}

export const useCaptureStore = create<CaptureStore>((set, get) => ({
  phase: "idle",
  title: "",
  muted: false,
  turns: [],
  speakers: {},
  notes: "",

  async start(source, language) {
    if (get().phase === "starting" || get().phase === "live") return;
    set({
      phase: "starting",
      title: source.title,
      source,
      muted: false,
      turns: [],
      speakers: {},
      notes: "",
      transcriptId: undefined,
      noteId: undefined,
      noteSpaceId: undefined,
      notice: undefined,
    });
    const channels: LiveChannel[] =
      source.kind === "mic" ? ["mic"] : source.mic ? ["mic", "system"] : ["system"];
    const live = new LiveTranscriber({
      onChange: (transcript) => set({ turns: savedTurns(transcript.turns()) }),
      onNotice: (notice) => set({ notice }),
    });
    const current: Running = {
      live,
      sessions: new Set(),
      native: false,
      startedAt: Date.now(),
      language,
      unlisten: [],
    };
    running = current;
    current.unlisten.push(
      listen<{ session: number; channel: LiveChannel; pcm: string }>(
        "misty://capture-audio",
        ({ payload }) => {
          if (current.sessions.has(payload.session))
            live.push(payload.channel, decode(payload.pcm));
        },
      ),
      listen<{ session: number; error?: string; notice?: string }>(
        "misty://capture-state",
        ({ payload }) => {
          const notice = payload.error || payload.notice;
          if (current.sessions.has(payload.session) && notice) set({ notice });
        },
      ),
    );
    try {
      const device = await voiceDeviceId();
      const ticket = await voiceApi.liveTicket({ device_id: device, channels, language });
      const hearsOther =
        source.kind === "system" || source.kind === "app" || source.kind === "recording";
      if (source.mic || source.kind === "mic" || hearsOther) {
        current.native = true;
        const session = await invoke<number>("voice_capture_start", {
          request: {
            mic: source.mic || source.kind === "mic",
            system: source.kind === "system" || source.kind === "recording",
            pids: source.pids ?? [],
          },
        });
        current.sessions.add(session);
      }
      if (source.kind === "tab" && source.tabId) {
        current.tabId = source.tabId;
        current.sessions.add(await invoke<number>("voice_tab_capture_start", { id: source.tabId }));
      }
      await live.connect(ticket.url, ticket.ticket, { language, context: { text: source.title } });
      if (running === current) set({ phase: "live" });
    } catch (error) {
      await release(current);
      live.close();
      if (running === current) running = undefined;
      set({ phase: "idle", notice: message(error, "Listening couldn't start.") });
    }
  },

  async toggleMute() {
    const muted = !get().muted;
    if (!running?.native || !get().source?.mic) return;
    await invoke("voice_capture_mute", { muted });
    set({ muted });
  },

  async stop() {
    const current = running;
    if (!current || get().phase !== "live") return;
    running = undefined;
    set({ phase: "saving" });
    await release(current);
    await current.live.finish();
    const turns = savedTurns(current.live.transcript.turns());
    const { source, title, speakers } = get();
    if (!turns.length || !source) {
      set({ phase: "idle", turns: [], notice: "Nothing was heard." });
      return;
    }
    try {
      const saved = await captureApi.save({
        title,
        language: current.language === "auto" ? "" : current.language,
        turns,
        speakers,
        source: { kind: source.kind, url: source.url, title: source.title },
        duration_ms: Date.now() - current.startedAt,
      });
      set({ phase: "done", turns, transcriptId: saved.id });
    } catch (error) {
      set({ phase: "done", turns, notice: message(error, "The transcript couldn't be saved.") });
    }
  },

  rename(speaker, name) {
    const speakers = { ...get().speakers };
    if (name.trim() && name.trim() !== speaker) speakers[speaker] = name.trim().slice(0, 80);
    else delete speakers[speaker];
    set({ speakers });
    const id = get().transcriptId;
    if (id)
      void captureApi
        .renameSpeakers(id, speakers)
        .catch(() => set({ notice: "The name couldn't be saved." }));
  },

  setNotes: (notes) => set({ notes }),

  async makeNote(mode) {
    const { transcriptId, notes, noteId } = get();
    if (!transcriptId || get().phase === "working") return;
    set({ phase: "working", notice: undefined });
    try {
      const result = await captureApi.notes(transcriptId, {
        mode,
        user_notes: notes || undefined,
        note_id: noteId,
      });
      set({
        phase: "done",
        noteId: result.note_id,
        noteSpaceId: result.space_id || get().noteSpaceId,
        title: result.title,
      });
    } catch (error) {
      set({ phase: "done", notice: message(error, "The note couldn't be made.") });
    }
  },

  show(transcript) {
    set({
      phase: "done",
      title: transcript.title,
      source: undefined,
      turns: transcript.turns,
      speakers: transcript.speakers,
      notes: "",
      transcriptId: transcript.id,
      noteId: undefined,
      noteSpaceId: undefined,
      notice: undefined,
      muted: false,
    });
  },

  close() {
    const current = running;
    running = undefined;
    if (current) {
      void release(current);
      current.live.close();
    }
    set({
      phase: "idle",
      turns: [],
      notes: "",
      transcriptId: undefined,
      noteId: undefined,
      notice: undefined,
    });
  },
}));
