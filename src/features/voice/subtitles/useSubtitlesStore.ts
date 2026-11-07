import { invoke } from "@tauri-apps/api/core";
import { emitTo, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";
import { useSettingsStore } from "@/features/settings";
import { pickSaveFile } from "@/native/sandbox";
import { errorText } from "@/shared/lib/format";
import { useCaptureStore } from "../capture/useCaptureStore";
import { deleteSubtitleSession, subtitleHistory, subtitleSessionText } from "./savedSubtitles";
import { savedSubtitlePrefs } from "./subtitlePrefs";
import { SubtitleSession } from "./subtitleSession";
import {
  noSubtitles,
  SUBTITLES_ACTION,
  SUBTITLES_READY,
  SUBTITLES_VIEW,
  subtitlesPanelLabel,
  type SubtitlePrefs,
  type SubtitlesAction,
  type SubtitlesView,
} from "./subtitlesView";

let view: SubtitlesView = noSubtitles;
let session: SubtitleSession | undefined;
let stopWatching: (() => void) | undefined;

function draw(next: Partial<SubtitlesView>) {
  view = { ...view, ...next };
  void emitTo(subtitlesPanelLabel(getCurrentWindow().label), SUBTITLES_VIEW, view).catch(() => undefined);
}

function setPrefs(patch: Partial<SubtitlePrefs>) {
  const prefs = { ...view.prefs, ...patch };
  draw({ prefs });
  useSettingsStore
    .getState()
    .updateSetting("voice", "subtitle_preferences", JSON.stringify(prefs));
}

async function start() {
  if (session || view.status !== "idle") return;
  const listening = useCaptureStore.getState().phase;
  if (listening === "starting" || listening === "live") {
    draw({ notice: "Misty is already listening. Stop that, then try again." });
    return;
  }
  draw({ status: "connecting", source: "", translation: "", notice: undefined, pageTopic: undefined });
  // The relay refuses without a key, and a refused socket can't say why.
  const keys = await invoke<string[]>("model_keys_saved").catch(() => ["soniox"]);
  if (!useSubtitlesStore.getState().on) return;
  if (!keys.includes("soniox")) {
    draw({ status: "idle", notice: "Add a Soniox key in Settings › Models to use live subtitles." });
    return;
  }
  const current: SubtitleSession = new SubtitleSession({
    prefs: () => view.prefs,
    draw: (next) => {
      if (session === current) draw(next);
    },
    ended: (notice) => {
      if (session !== current) return;
      session = undefined;
      draw({ status: "idle", notice, history: subtitleHistory() });
    },
  });
  session = current;
  await current.start();
}

async function exportSession(id: string) {
  const text = subtitleSessionText(id);
  if (text === undefined) return;
  const path = await pickSaveFile({
    defaultName: `Live subtitles ${id.slice(0, 10)}.txt`,
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
  if (path) await invoke("voice_subtitles_export", { path, text });
}

function act(action: SubtitlesAction) {
  switch (action.type) {
    case "start":
      return void start();
    case "stop":
      return void session?.stop();
    case "close":
      return void useSubtitlesStore.getState().close();
    case "dismiss":
      return draw({ notice: undefined });
    case "prefs":
      return setPrefs(action.patch);
    case "export":
      return void exportSession(action.id).catch((error: unknown) =>
        draw({ notice: errorText(error) || "That session couldn't be exported." }),
      );
    case "delete":
      deleteSubtitleSession(action.id);
      return draw({ history: subtitleHistory() });
  }
}

interface SubtitlesStore {
  /** The panel is up, listening or not. */
  on: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
}

/** The panel draws what this window sends. Nothing it hears is saved unless Save sessions is on. */
export const useSubtitlesStore = create<SubtitlesStore>((set, get) => ({
  on: false,

  async open() {
    if (get().on) return;
    set({ on: true });
    view = {
      ...noSubtitles,
      prefs: savedSubtitlePrefs(useSettingsStore.getState().settings?.document),
      history: subtitleHistory(),
    };
    // Only this window's panel, not another window's that's open at the same time.
    const events: Promise<UnlistenFn>[] = [
      getCurrentWebview().listen(SUBTITLES_READY, () => draw({})),
      getCurrentWebview().listen<SubtitlesAction>(SUBTITLES_ACTION, ({ payload }) => act(payload)),
      getCurrentWindow().onResized(() => void invoke("voice_subtitles_fit").catch(() => undefined)),
    ];
    const stopCapture = useCaptureStore.subscribe((state, previous) => {
      if (state.phase === "starting" && previous.phase !== "starting")
        session?.abandon("Subtitles stopped because Misty started listening.");
    });
    const leaving = () => void get().close();
    window.addEventListener("pagehide", leaving);
    stopWatching = () => {
      for (const remove of events) void remove.then((fn) => fn());
      stopCapture();
      window.removeEventListener("pagehide", leaving);
    };
    try {
      await invoke("voice_subtitles_show");
    } catch (error) {
      stopWatching();
      stopWatching = undefined;
      set({ on: false });
      throw error;
    }
  },

  async close() {
    if (!get().on) return;
    set({ on: false });
    stopWatching?.();
    stopWatching = undefined;
    await session?.stop();
    session = undefined;
    await invoke("voice_subtitles_hide").catch(() => undefined);
  },
}));
