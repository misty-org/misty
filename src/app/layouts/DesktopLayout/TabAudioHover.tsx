import { useEffect, useRef } from "react";
import { useBrowserOverlayControl } from "@/features/browser";
import { BrowserViewAudioButton } from "@/features/browser/workspace";
import { useBrowserMediaStore } from "@/features/browser/library";
import type { WorkspaceView } from "@/features/workspace/model";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui";
import { NowPlayingFor } from "./NowPlayingFor";
import { useMediaInfo } from "./useNowPlaying";
import "./nowPlaying.css";

const openDelayMs = 120;
const closeDelayMs = 250;

/**
 * A tab's audio icon, which shows that tab's media player while the pointer rests on it:
 * title, position and controls, the way the sidebar's card does for every playing tab.
 */
export function TabAudioHover(props: { tabs: WorkspaceView[]; side?: "bottom" | "right" }) {
  const view = useBrowserMediaStore((state) => {
    const browserTabs = props.tabs.filter((tab) => tab.surfaceId === "browser");
    return browserTabs.find((tab) => state.audible[tab.id] || state.paused[tab.id]);
  });
  const overlay = useBrowserOverlayControl(`now-playing-tab:${view?.id ?? ""}`);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const info = useMediaInfo(view ? [view] : [], overlay.open);
  const schedule = (open: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => overlay.onOpenChange(open), delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!view && overlay.open) overlay.onOpenChange(false);
  }, [view, overlay]);
  const button = <BrowserViewAudioButton tabs={props.tabs} />;
  if (!view) return button;
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
        align="start"
        sideOffset={8}
        aria-label="Now playing"
        className="misty-now-playing"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={() => schedule(false, closeDelayMs)}
      >
        <NowPlayingFor
          view={view}
          info={info[view.id]}
          onOpen={() => overlay.onOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
