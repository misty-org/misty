import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { uploadLibraryPath } from "@/api/spaces/library-upload";
import { memoryApi } from "@/features/recall";
import { useSpacesStore } from "@/features/spaces";
import { captureApi } from "../capture/captureApi";
import { useCaptureStore } from "../capture/useCaptureStore";

/** Uploads stay within the Library's per-file limit for the desktop uploader. */
export const RECORDING_UPLOAD_LIMIT = 100 * 1024 * 1024;

type Phase = "idle" | "starting" | "recording" | "saving";

interface RecordingStore {
  phase: Phase;
  path?: string;
  notice?: string;
  start(options: { microphone: boolean; language: string }): Promise<void>;
  stop(): Promise<void>;
}

/** The person's own Space: the default Space they own. */
function personalSpaceId() {
  const spaces = useSpacesStore.getState().spaces;
  return (
    spaces.find((space) => space.is_default && space.role === "owner") ??
    spaces.find((space) => space.is_default)
  )?.id;
}

const say = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * A capture session: the screen goes to a video file while the live capture
 * transcribes what is said and played. On stop the video joins the Library,
 * the transcript links to it and gets a summary Note, and Memory notes it.
 */
export const useRecordingStore = create<RecordingStore>((set, get) => ({
  phase: "idle",

  async start({ microphone, language }) {
    if (get().phase !== "idle") return;
    set({ phase: "starting", notice: undefined });
    try {
      const path = await invoke<string>("voice_recording_start", { request: { microphone } });
      set({ phase: "recording", path });
      await useCaptureStore
        .getState()
        .start({ kind: "recording", title: "Screen recording", mic: microphone }, language);
      // Capture reports its own failures by going back to idle.
      const listening = useCaptureStore.getState();
      if (listening.phase === "idle")
        throw new Error(listening.notice || "Listening couldn't start.");
    } catch (error) {
      if (get().path) await invoke("voice_recording_stop", { path: get().path }).catch(() => {});
      set({ phase: "idle", path: undefined, notice: say(error, "Recording couldn't start.") });
    }
  },

  async stop() {
    const path = get().path;
    if (get().phase !== "recording" || !path) return;
    set({ phase: "saving" });
    let file: { path: string; seconds: number; bytes: number } | undefined;
    try {
      file = await invoke<{ path: string; seconds: number; bytes: number }>(
        "voice_recording_stop",
        { path },
      );
    } catch (error) {
      set({ notice: say(error, "The recording couldn't be saved.") });
    }
    await useCaptureStore.getState().stop();
    const transcriptId = useCaptureStore.getState().transcriptId;
    const spaceId = personalSpaceId();
    if (!file || !spaceId) return set({ phase: "idle", path: undefined });
    if (file.bytes > RECORDING_UPLOAD_LIMIT) {
      return set({
        phase: "idle",
        path: undefined,
        notice: `The recording is too large to add to your Library. It's kept at ${file.path}.`,
      });
    }
    try {
      const uploaded = await uploadLibraryPath(spaceId, file.path, "library");
      const itemId = uploaded.item?.id;
      if (itemId && transcriptId)
        await captureApi.recordingItem(transcriptId, itemId).catch(() => {});
      if (itemId)
        void memoryApi
          .record({
            kind: "recording",
            title: `Screen recording, ${Math.round(file.seconds / 60) || 1} min`,
            ref_id: itemId,
            occurred_at: new Date().toISOString(),
          })
          .catch(() => {});
      await invoke("voice_recording_discard", { path: file.path }).catch(() => {});
      set({ phase: "idle", path: undefined, notice: "The recording is in your Library." });
      if (transcriptId) void useCaptureStore.getState().makeNote("summary");
    } catch (error) {
      set({
        phase: "idle",
        path: undefined,
        notice: `${say(error, "The recording couldn't be uploaded.")} It's kept at ${file.path}.`,
      });
    }
  },
}));
