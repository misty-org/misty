import { emptySubtitleContext, type SubtitleContext } from "./subtitleContext";

/** The window's label and the events between it and the window that opened it. */
export const SUBTITLES_WINDOW = "misty-live-subtitles";
export const SUBTITLES_VIEW = "misty://live-subtitles";
export const SUBTITLES_READY = "misty://live-subtitles-ready";
export const SUBTITLES_ACTION = "misty://live-subtitles-action";

export type SubtitleInput = "system" | "mic";
export type SubtitleMode = "subtitles" | "translate";
export type SubtitleStatus = "idle" | "connecting" | "live" | "stopping";

/** What the panel's controls set, kept per device. */
export interface SubtitlePrefs {
  input: SubtitleInput;
  /** An app to hear instead of everything; empty for this computer's sound. */
  app: string;
  mode: SubtitleMode;
  source: string;
  target: string;
  context: SubtitleContext;
  micGain: number;
  micMuted: boolean;
  desktopGain: number;
  desktopMuted: boolean;
  silenceSeconds: number;
  silenceDbfs: number;
  /** Keep each session in History, on this computer. */
  save: boolean;
}

export interface SubtitleHistoryRow {
  id: string;
  startedAt: string;
  preview: string;
}

/** Everything the floating window draws. It holds no session of its own. */
export interface SubtitlesView {
  status: SubtitleStatus;
  source: string;
  translation: string;
  /** Why nothing is coming, or what just happened. */
  notice?: string;
  prefs: SubtitlePrefs;
  /** Apps playing sound right now. */
  apps: string[];
  microphone: string;
  history: SubtitleHistoryRow[];
}

export type SubtitlesAction =
  | { type: "start" }
  | { type: "stop" }
  | { type: "close" }
  | { type: "dismiss" }
  | { type: "refreshApps" }
  | { type: "prefs"; patch: Partial<SubtitlePrefs> }
  | { type: "export"; id: string }
  | { type: "delete"; id: string };

export const defaultSubtitlePrefs: SubtitlePrefs = {
  input: "system",
  app: "",
  mode: "translate",
  source: "auto",
  target: "en",
  context: emptySubtitleContext(),
  micGain: 1,
  micMuted: false,
  desktopGain: 1,
  desktopMuted: false,
  silenceSeconds: 30,
  silenceDbfs: -60,
  save: false,
};

export const noSubtitles: SubtitlesView = {
  status: "idle",
  source: "",
  translation: "",
  prefs: defaultSubtitlePrefs,
  apps: [],
  microphone: "",
  history: [],
};
