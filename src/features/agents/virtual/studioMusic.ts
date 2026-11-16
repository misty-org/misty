import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { hasTauriInternals } from "@/shared/platform/tauri";

/*
 * The studio's music player: a music service's own website in a page of its own
 * (`browser/studio_music.rs`), signed in to by the person, with its own sign-ins apart from every
 * agent page. The panel shows that page, or shrinks to a player card that reads and presses the
 * page's own media controls. Hiding either only moves the page out of sight, so the music goes
 * on; closing the card ends it.
 */

export const musicServices = [
  { id: "youtube-music", label: "YouTube Music" },
  { id: "spotify", label: "Spotify" },
  { id: "apple-music", label: "Apple Music" },
  { id: "soundcloud", label: "SoundCloud" },
] as const;
export type MusicService = (typeof musicServices)[number]["id"];

const isService = (value: unknown): value is MusicService =>
  musicServices.some((service) => service.id === value);

const LAST = "misty:studio-music-service";

function lastService(): MusicService {
  try {
    const saved = localStorage.getItem(LAST);
    return isService(saved) ? saved : "youtube-music";
  } catch {
    return "youtube-music";
  }
}

export interface MusicBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the player is playing, as the service's page reports it (`studio_music_media.rs`). */
export interface MusicMedia {
  title: string;
  artist: string;
  artwork: string;
  playing: boolean;
  position: number | null;
  duration: number | null;
  canPrevious: boolean;
  canNext: boolean;
  canSeek: boolean;
  muted: boolean;
}

export type MusicAction = "play" | "pause" | "previoustrack" | "nexttrack" | "seekto";

/** The panel shows the service's page, to browse and sign in, or the small player card. */
export type MusicView = "page" | "player";

interface MusicState {
  service: MusicService;
  /** The panel is up: music's own things are showing. */
  shown: boolean;
  view: MusicView;
  /** The service list is open; the page steps out of its way. */
  menuOpen: boolean;
  /** The panel's frame for the page is on screen. */
  framed: boolean;
  /** The player exists, seen or not: something may be playing. */
  live: boolean;
  /** The service the open player is on. */
  on: MusicService | null;
  media: MusicMedia | null;
  error: string;
  /** Shows the panel: the player card when something is open, else the service's page. */
  show(): void;
  /** Hides the panel; the music goes on. */
  hide(): void;
  /** Closes the player, and the music with it. */
  stop(): Promise<void>;
  choose(service: MusicService): void;
  /** Shows the service's page in the panel. */
  expand(): void;
  /** Shrinks the panel to the player card; the page goes out of sight, still playing. */
  collapse(): void;
  setMenuOpen(open: boolean): void;
  /** The frame for the page came or went; gone, the page goes out of sight. */
  setFramed(framed: boolean): void;
  /** Puts the page over the panel's frame, opening it the first time. */
  place(bounds: MusicBounds): Promise<void>;
  /** Puts the page out of sight, still playing. */
  park(): void;
  /** Reads what is playing now. */
  refresh(): Promise<void>;
  act(action: MusicAction, seconds?: number): void;
  toggleMute(): void;
  /** Reads whether a player is already open, after the studio was away. */
  sync(): Promise<void>;
}

/** Whether the service's page belongs over the panel's frame right now. */
export const pageWanted = (state: Pick<MusicState, "shown" | "view" | "menuOpen" | "framed">) =>
  state.shown && state.view === "page" && !state.menuOpen && state.framed;

const native = hasTauriInternals();

export const useStudioMusic = create<MusicState>((set, get) => ({
  service: lastService(),
  shown: false,
  view: "page",
  menuOpen: false,
  framed: false,
  live: false,
  on: null,
  media: null,
  error: "",
  show: () => set({ shown: true, view: get().live ? "player" : "page", error: "" }),
  hide() {
    set({ shown: false, menuOpen: false });
    get().park();
  },
  async stop() {
    set({ shown: false, live: false, on: null, media: null, view: "page", menuOpen: false });
    if (native) await invoke("studio_music_close").catch(() => undefined);
  },
  choose(service) {
    try {
      localStorage.setItem(LAST, service);
    } catch {
      // Remembered for this window only.
    }
    // A new service opens on its page.
    set({ service, view: "page" });
  },
  expand: () => set({ view: "page" }),
  collapse() {
    set({ view: "player", menuOpen: false });
    get().park();
  },
  setMenuOpen(menuOpen) {
    set({ menuOpen });
    if (menuOpen) get().park();
  },
  setFramed(framed) {
    set({ framed });
    if (!framed) get().park();
  },
  async place(bounds) {
    if (!native || !pageWanted(get())) return;
    try {
      const { service, live, on } = get();
      // Following the panel only moves the page; opening or switching service loads it.
      if (live && on === service) await invoke("studio_music_place", { bounds });
      else await invoke("studio_music_open", { service, bounds });
      set({ live: true, on: service, error: "" });
      // The page stopped being wanted while it was opening: it goes out of sight, still playing.
      if (!pageWanted(get())) get().park();
    } catch (reason) {
      set({ error: reason instanceof Error ? reason.message : String(reason) });
    }
  },
  park() {
    // Even before the player says it's open: one still opening is put away as soon as it is.
    if (native) void invoke("studio_music_hide").catch(() => undefined);
  },
  async refresh() {
    if (!native || !get().live) return;
    const media = await invoke<MusicMedia | null>("studio_music_media").catch(() => null);
    if (get().live) set({ media });
  },
  act(action, seconds) {
    if (!native) return;
    const media = get().media;
    // The card answers at once; the next report from the page confirms it.
    if (media && (action === "play" || action === "pause"))
      set({ media: { ...media, playing: action === "play" } });
    void invoke("studio_music_act", { action, seconds })
      .then(() => get().refresh())
      .catch(() => undefined);
  },
  toggleMute() {
    const media = get().media;
    if (!native || !media) return;
    const muted = !media.muted;
    set({ media: { ...media, muted } });
    void invoke("studio_music_mute", { muted }).catch(() => undefined);
  },
  async sync() {
    if (!hasTauriInternals()) return;
    const open = await invoke<string | null>("studio_music_state").catch(() => null);
    set(
      isService(open)
        ? { live: true, service: open, on: open }
        : { live: false, on: null, media: null },
    );
  },
}));

// A reload of Misty's own page forgets the panel, not the player: it starts out of sight.
if (native) void invoke("studio_music_hide").catch(() => undefined);
