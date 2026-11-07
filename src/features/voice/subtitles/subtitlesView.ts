import { emptySubtitleContext, type SubtitleContext } from "./subtitleContext";

/** Each Misty window's panel is a view inside it, labelled after it. */
const PANEL_PREFIX = "misty-live-subtitles-";
export const subtitlesPanelLabel = (window: string) => `${PANEL_PREFIX}${window}`;
export const isSubtitlesPanel = (label: string) => label.startsWith(PANEL_PREFIX);

/** The events between the panel and the window it's in. */
export const SUBTITLES_VIEW = "misty://live-subtitles";
export const SUBTITLES_READY = "misty://live-subtitles-ready";
export const SUBTITLES_ACTION = "misty://live-subtitles-action";

export type SubtitleMode = "subtitles" | "translate";
export type SubtitleStatus = "idle" | "connecting" | "live" | "stopping";

/** What the panel's controls set, kept per device. */
export interface SubtitlePrefs {
  mode: SubtitleMode;
  source: string;
  target: string;
  context: SubtitleContext;
  gain: number;
  muted: boolean;
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

/** Everything the panel draws. It holds no session of its own. */
export interface SubtitlesView {
  status: SubtitleStatus;
  source: string;
  translation: string;
  /** Why nothing is coming, or what just happened. */
  notice?: string;
  /** What the model made of the page in front, if it could. */
  pageTopic?: string;
  prefs: SubtitlePrefs;
  history: SubtitleHistoryRow[];
}

export type SubtitlesAction =
  | { type: "start" }
  | { type: "stop" }
  | { type: "close" }
  | { type: "dismiss" }
  | { type: "prefs"; patch: Partial<SubtitlePrefs> }
  | { type: "export"; id: string }
  | { type: "delete"; id: string };

export const defaultSubtitlePrefs: SubtitlePrefs = {
  mode: "translate",
  source: "auto",
  target: "en",
  context: emptySubtitleContext(),
  gain: 1,
  muted: false,
  silenceSeconds: 30,
  silenceDbfs: -60,
  save: false,
};

export const noSubtitles: SubtitlesView = {
  status: "idle",
  source: "",
  translation: "",
  prefs: defaultSubtitlePrefs,
  history: [],
};
