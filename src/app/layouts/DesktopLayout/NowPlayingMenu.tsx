import { useMemo } from "react";
import { Music, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { browserPageTools, useBrowserMediaStore } from "@/features/browser/library";
import { browserRuntimeIdForTabId } from "@/features/webviews/browserRuntime";
import { workspaceTabsById } from "@/features/workspace/layoutTabs";
import type { WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  IconButton,
  MenuTrigger,
} from "@/shared/ui";

/**
 * Every tab playing sound, in any virtual window, with play/pause and mute,
 * like Chrome's media controls. Shown only while something plays or was
 * paused here.
 */
export function NowPlayingMenu(props: { onOpen(view: WorkspaceView): void }) {
  const audible = useBrowserMediaStore((state) => state.audible);
  const paused = useBrowserMediaStore((state) => state.paused);
  const muted = useBrowserMediaStore((state) => state.muted);
  // The windows object is stable between edits; a fresh map per render is not.
  const windowsByScope = useWorkspaceStore((state) => state.windowsByScope);
  const playing = useMemo(
    () =>
      [...workspaceTabsById({ windowsByScope }).values()].filter(
        (view) => view.surfaceId === "browser" && (audible[view.id] || paused[view.id]),
      ),
    [windowsByScope, audible, paused],
  );
  if (!playing.length) return null;
  const toggle = (view: WorkspaceView) => {
    const runtimeId = browserRuntimeIdForTabId(view.id);
    if (!runtimeId) return;
    const pause = !paused[view.id];
    void browserPageTools
      .mediaPlayback(runtimeId, pause ? "pause" : "play")
      .then(() => useBrowserMediaStore.getState().setPaused(view.id, pause))
      .catch(() => {});
  };
  return (
    <DropdownMenu modal={false}>
      <MenuTrigger iconOnly size="xs" label="Media playing" icon={<Music className="size-4" />} />
      <DropdownMenuContent align="end" width="lg">
        {playing.map((view) => {
          const isPaused = Boolean(paused[view.id]);
          const isMuted = Boolean(muted[view.id]);
          return (
            <div key={view.id} className="flex items-center gap-1">
              <DropdownMenuItem
                className="min-w-0 flex-1"
                onSelect={() => {
                  if (useWorkspaceStore.getState().focusView(view.id)) props.onOpen(view);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{view.title}</span>
              </DropdownMenuItem>
              <IconButton
                size="xs"
                label={isPaused ? `Play ${view.title}` : `Pause ${view.title}`}
                onClick={() => toggle(view)}
              >
                {isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              </IconButton>
              <IconButton
                size="xs"
                label={isMuted ? `Unmute ${view.title}` : `Mute ${view.title}`}
                onClick={() => void useBrowserMediaStore.getState().toggleMuted(view.id)}
              >
                {isMuted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
              </IconButton>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
