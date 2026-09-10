import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Volume2 } from "lucide-react";
import { useBrowserOverlayControl } from "@/features/browser";
import {
  browserPageTools,
  useBrowserMediaStore,
  type BrowserMediaInfo,
} from "@/features/browser/library";
import { browserRuntimeIdForTabId } from "@/features/webviews/browserRuntime";
import { workspaceTabsById } from "@/features/workspace/layoutTabs";
import type { WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  appIconStrokeWidth,
  cn,
  IconButton,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui";
import { NowPlayingCard } from "./NowPlayingCard";
import { navigatorFocusRingClass } from "./styles";
import "./nowPlaying.css";

const openDelayMs = 120;
const closeDelayMs = 250;
const refreshMs = 1_000;

/**
 * A plain speaker in the rail while any tab plays sound, in any window.
 * Hovering opens the media player beside the rail; clicking keeps it open
 * until it is dismissed (docs/design/media-controls).
 */
export function NowPlayingRail(props: { className?: string }) {
  const playing = usePlayingViews();
  const overlay = useBrowserOverlayControl("now-playing");
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const info = useMediaInfo(playing, overlay.open);
  const pausedTabs = useBrowserMediaStore((state) => state.paused);
  const mutedTabs = useBrowserMediaStore((state) => state.muted);
  const navigate = useNavigate();

  const schedule = (open: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => overlay.onOpenChange(open), delay);
  };
  const close = () => {
    clearTimeout(timer.current);
    setPinned(false);
    overlay.onOpenChange(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!playing.length && overlay.open) close();
    // Closing is only needed when the last tab stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing.length]);

  if (!playing.length) return null;
  const hoverOpen = () => schedule(true, openDelayMs);
  const hoverClose = () => {
    if (!pinned) schedule(false, closeDelayMs);
  };

  return (
    <Popover open={overlay.open} onOpenChange={(open) => (open ? undefined : close())}>
      <PopoverAnchor asChild>
        <IconButton
          variant="nav-action"
          label={playing.length > 1 ? `${playing.length} tabs playing` : "Now playing"}
          tooltip={false}
          aria-expanded={overlay.open}
          aria-haspopup="dialog"
          className={cn(navigatorFocusRingClass, props.className)}
          data-misty-window-drag-block="true"
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
          onClick={() => {
            if (pinned && overlay.open) return close();
            clearTimeout(timer.current);
            setPinned(true);
            overlay.onOpenChange(true);
          }}
        >
          <Volume2
            className="size-4 shrink-0"
            size={16}
            strokeWidth={appIconStrokeWidth}
            aria-hidden="true"
          />
        </IconButton>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label="Now playing"
        className="misty-now-playing"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={hoverClose}
      >
        {playing.map((view) => (
          <NowPlayingCard
            key={view.id}
            view={view}
            info={info[view.id]}
            paused={Boolean(pausedTabs[view.id]) || Boolean(info[view.id]?.paused)}
            muted={Boolean(mutedTabs[view.id])}
            onAction={(action) => act(view, action)}
            onToggleMute={() => void useBrowserMediaStore.getState().toggleMuted(view.id)}
            onOpen={() => {
              close();
              if (useWorkspaceStore.getState().focusView(view.id)) navigate(view.route);
            }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Browser tabs playing sound, or paused from the player, across every window. */
function usePlayingViews(): WorkspaceView[] {
  const audible = useBrowserMediaStore((state) => state.audible);
  const paused = useBrowserMediaStore((state) => state.paused);
  // The windows object is stable between edits; a fresh map per render is not.
  const windowsByScope = useWorkspaceStore((state) => state.windowsByScope);
  return useMemo(
    () =>
      [...workspaceTabsById({ windowsByScope }).values()].filter(
        (view) => view.surfaceId === "browser" && (audible[view.id] || paused[view.id]),
      ),
    [windowsByScope, audible, paused],
  );
}

/** Each playing page's own media details, refreshed while the player is open. */
function useMediaInfo(views: WorkspaceView[], open: boolean) {
  const [info, setInfo] = useState<Record<string, BrowserMediaInfo>>({});
  const ids = views.map((view) => view.id).join(" ");
  useEffect(() => {
    if (!open) return;
    let current = true;
    const refresh = () =>
      ids
        .split(" ")
        .filter(Boolean)
        .forEach((tabId) => {
          const runtimeId = browserRuntimeIdForTabId(tabId);
          if (!runtimeId) return;
          void browserPageTools
            .mediaInfo(runtimeId)
            .then((next) => current && setInfo((previous) => ({ ...previous, [tabId]: next })))
            .catch(() => undefined);
        });
    refresh();
    const interval = setInterval(refresh, refreshMs);
    return () => {
      current = false;
      clearInterval(interval);
    };
  }, [ids, open]);
  return info;
}

function act(view: WorkspaceView, action: "play" | "pause" | "previoustrack" | "nexttrack") {
  const runtimeId = browserRuntimeIdForTabId(view.id);
  if (!runtimeId) return;
  void browserPageTools
    .mediaAction(runtimeId, action)
    .then(() => {
      // Paused from here, the tab stays listed so it can be resumed.
      if (action === "pause") useBrowserMediaStore.getState().setPaused(view.id, true);
      if (action === "play") useBrowserMediaStore.getState().setPaused(view.id, false);
    })
    .catch(() => undefined);
}
