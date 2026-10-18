import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { useBrowserOverlayControl } from "@/features/browser";
import { useBrowserMediaStore } from "@/features/browser/library";
import type { WorkspaceView } from "@/features/workspace/model";
import { IconButton, Popover, PopoverAnchor, PopoverContent } from "@/shared/ui";
import { NowPlayingCrumbs, useChosenSource } from "./NowPlayingCrumbs";
import { NowPlayingFor } from "./NowPlayingFor";
import { actOnMedia, useMediaInfo } from "./useNowPlaying";
import "./nowPlaying.css";

const openDelayMs = 120;
const closeDelayMs = 250;

/**
 * A horizontal tab's audio icon, which shows the tab's media player while the pointer rests on
 * it: title, position and controls, the way the sidebar's card does. A split tab can hold several
 * sources, one per pane; breadcrumbs at the card's foot switch between them.
 *
 * The icon speaks for the whole tab. While anything plays it is a speaker that mutes or unmutes
 * every source at once (each card's own mute still sets one source apart), muted only once every
 * playing source is. When nothing plays it is a play icon, muted or not, that resumes the source
 * on the card, until every player is closed or its page has no media left.
 */
export function TabAudioHover(props: { tabs: WorkspaceView[]; side?: "bottom" | "right" }) {
  const audible = useBrowserMediaStore((state) => state.audible);
  const muted = useBrowserMediaStore((state) => state.muted);
  const paused = useBrowserMediaStore((state) => state.paused);
  const heard = useBrowserMediaStore((state) => state.heard);
  const media = useBrowserMediaStore((state) => state.info);
  const dismissed = useBrowserMediaStore((state) => state.dismissed);
  // The same sources the sidebar lists, limited to this tab's panes.
  const sources = useMemo(
    () =>
      props.tabs.filter(
        (view) =>
          view.surfaceId === "browser" &&
          (audible[view.id] ||
            (!dismissed[view.id] &&
              (paused[view.id] || (heard[view.id] && media[view.id]?.hasMedia)))),
      ),
    [props.tabs, audible, paused, heard, media, dismissed],
  );
  const isPlaying = (view: WorkspaceView) =>
    !(media[view.id]?.paused ?? (Boolean(paused[view.id]) || !audible[view.id]));
  const playing = sources.filter(isPlaying);
  // A muted page that has gone quiet keeps the speaker so it can be unmuted.
  const mutedQuiet = props.tabs.filter(
    (view) => view.surfaceId === "browser" && muted[view.id] && !sources.includes(view),
  );
  const speakerSources = playing.length ? playing : mutedQuiet;
  const allMuted = speakerSources.length > 0 && speakerSources.every((view) => muted[view.id]);

  const { index, current, choose } = useChosenSource(sources);
  // One overlay for the tab, so switching sources in the open card keeps it open.
  const overlay = useBrowserOverlayControl(`now-playing-tab:${useId()}`);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const info = useMediaInfo(sources, overlay.open);
  const schedule = (open: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => overlay.onOpenChange(open), delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!current && overlay.open) overlay.onOpenChange(false);
  }, [current, overlay]);

  const toggleAll = () => {
    const store = useBrowserMediaStore.getState();
    const mute = !allMuted;
    for (const view of speakerSources) {
      if (Boolean(store.muted[view.id]) !== mute) void store.toggleMuted(view.id);
    }
  };
  let button: ReactNode = null;
  if (speakerSources.length) {
    const Icon = allMuted ? VolumeX : Volume2;
    button = (
      <IconButton
        label={allMuted ? "Unmute tab" : "Mute tab"}
        tooltip={false}
        size="xs"
        className="misty-tab-media-button"
        data-reorder-ignore="true"
        onClick={(event) => {
          event.stopPropagation();
          toggleAll();
        }}
      >
        <Icon className="size-3" size={12} aria-hidden="true" />
      </IconButton>
    );
  } else if (current) {
    button = (
      <IconButton
        label="Resume playback"
        tooltip={false}
        size="xs"
        className="misty-tab-media-button"
        data-reorder-ignore="true"
        onClick={(event) => {
          event.stopPropagation();
          actOnMedia(current, "play");
        }}
      >
        <Play className="size-3" size={12} aria-hidden="true" />
      </IconButton>
    );
  }
  if (!current) return button;
  return (
    <Popover
      open={overlay.open}
      onOpenChange={(open) => {
        if (!open) overlay.onOpenChange(false);
      }}
    >
      <PopoverAnchor asChild>
        <span
          className="inline-flex"
          onPointerEnter={() => schedule(true, openDelayMs)}
          onPointerLeave={() => schedule(false, closeDelayMs)}
        >
          {button}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side={props.side ?? "bottom"}
        // Centered under the icon, so the player sits over its own tab, not the next one.
        align="center"
        sideOffset={8}
        aria-label="Now playing"
        className="misty-now-playing"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={() => schedule(false, closeDelayMs)}
      >
        {/* Not keyed by source, so the breadcrumbs animate as you switch. */}
        <NowPlayingFor
          view={current}
          info={info[current.id]}
          onOpen={() => overlay.onOpenChange(false)}
          footer={<NowPlayingCrumbs sources={sources} index={index} onChoose={choose} />}
        />
      </PopoverContent>
    </Popover>
  );
}
