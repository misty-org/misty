import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** What the Code page's sidebar shows. */
export type CodeActivity = "sessions" | "files" | "search" | "changes" | "live" | "databases";

const activities: readonly CodeActivity[] = [
  "sessions",
  "files",
  "search",
  "changes",
  "live",
  "databases",
];

/** The Code page as the person left it, for this device: what's open and how big it is. */
export interface CodePageLayout {
  activity: CodeActivity;
  sidebarOpen: boolean;
  terminalOpen: boolean;
  /** The sidebar's share of the page's width, in percent. */
  sidebarSize: number;
  /** The terminal's share of the main column's height, in percent. */
  terminalSize: number;
  /** The project folder the page works in while no chat is open in it; "" before one is picked. */
  lastProject: string;
  /** The chat open in the column beside the editor, by conversation id; "" for none. */
  chat: string;
  /** The chat column's share of the main area's width, in percent. */
  chatSize: number;
}

const defaults: CodePageLayout = {
  // A new layout opens on the sessions; a saved one keeps the view it had.
  activity: "sessions",
  sidebarOpen: true,
  terminalOpen: false,
  sidebarSize: 22,
  terminalSize: 30,
  lastProject: "",
  chat: "",
  chatSize: 40,
};

const clamp = (value: unknown, low: number, high: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(high, Math.max(low, value))
    : fallback;

export const useCodePageLayout = createDeviceSetting<CodePageLayout>({
  scope: "code-page-layout",
  defaults,
  normalize: (stored) => {
    const saved = (stored ?? {}) as Partial<CodePageLayout>;
    return {
      activity: activities.includes(saved.activity as CodeActivity)
        ? (saved.activity as CodeActivity)
        : defaults.activity,
      sidebarOpen: saved.sidebarOpen !== false,
      terminalOpen: saved.terminalOpen === true,
      sidebarSize: clamp(saved.sidebarSize, 12, 50, defaults.sidebarSize),
      terminalSize: clamp(saved.terminalSize, 10, 80, defaults.terminalSize),
      lastProject: typeof saved.lastProject === "string" ? saved.lastProject : "",
      chat: typeof saved.chat === "string" ? saved.chat : "",
      chatSize: clamp(saved.chatSize, 20, 70, defaults.chatSize),
    };
  },
});

/** Changes part of the saved layout. */
export function updateCodePageLayout(patch: Partial<CodePageLayout>) {
  const current = useCodePageLayout.getState().value;
  useCodePageLayout.getState().set({ ...current, ...patch });
}

/**
 * How many Code pages this window shows right now. Opening a file from Changes or search goes to
 * the page's editor while one is shown, and to the chat's files panel otherwise.
 */
export const useCodePageShown = create<{ count: number }>(() => ({ count: 0 }));

export const isCodePageShown = () => useCodePageShown.getState().count > 0;

/** The route that shows an opened file: the Code page when it is up, else a chat's panel. */
export const fileRoute = () => (isCodePageShown() ? "/agents?view=code" : "/agents");
