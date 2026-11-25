import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { IconButton, MediaPlayerCard, Surface } from "@misty/ui";
import type { WorkspaceView } from "@/features/app-windows";
import {
  actOnPageMedia,
  closePageMedia,
  followPageMedia,
  setPageMuted,
  usePageMedia,
} from "@/features/browser";
import { usePlayingSources, type PlayingSource } from "./page_media_views";
import { WorkspaceTabIcon } from "./WorkspaceTabIcon";

const MOST_SHOWN = 3;

export function SidebarNowPlaying(props: { onOpen(view: WorkspaceView): void }) {
  useEffect(() => followPageMedia(), []);
  const sources = usePlayingSources();
  const closed = usePageMedia((state) => state.closed);
  const shown = useMemo(
    () =>
      sources
        .filter((source) => !closed[source.page.key])
        .sort(
          (a, b) =>
            Number(b.page.media.playing) - Number(a.page.media.playing) ||
            b.page.startedAt - a.page.startedAt,
        )
        .slice(0, MOST_SHOWN),
    [sources, closed],
  );
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-2 pb-2" aria-label="Now playing" role="group">
      {shown.map((source) => (
        <NowPlaying key={source.page.key} source={source} onOpen={props.onOpen} />
      ))}
    </div>
  );
}

function NowPlaying({
  source,
  onOpen,
}: {
  source: PlayingSource;
  onOpen(view: WorkspaceView): void;
}) {
  const { page, view, name } = source;
  const { media } = page;
  const muted = usePageMedia((state) => Boolean(state.muted[page.key]));
  const [open, setOpen] = useState(false);
  const title = media.title || name;
  return (
    <Surface
      as="section"
      tone="faint"
      radius="xl"
      aria-label={title}
      data-misty-window-drag-block="true"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <MediaPlayerCard
        compact={!open}
        title={title}
        detail={media.artist || (media.title ? name : undefined)}
        artwork={media.artwork || undefined}
        playing={media.playing}
        position={media.position}
        length={media.duration}
        muted={muted}
        canPrevious={media.canPrevious}
        canNext={media.canNext}
        onPlay={() => actOnPageMedia(page, "play")}
        onPause={() => actOnPageMedia(page, "pause")}
        onPrevious={() => actOnPageMedia(page, "previoustrack")}
        onNext={() => actOnPageMedia(page, "nexttrack")}
        onSeek={media.canSeek ? (seconds) => actOnPageMedia(page, "seekto", seconds) : undefined}
        onToggleMute={() => setPageMuted(page, !muted)}
        source={
          view ? (
            <IconButton label={`Show ${name || title}`} onClick={() => onOpen(view)}>
              <WorkspaceTabIcon view={view} />
            </IconButton>
          ) : null
        }
        actions={
          <IconButton size="sm" label="Close player" onClick={() => closePageMedia(page)}>
            <X aria-hidden="true" />
          </IconButton>
        }
      />
    </Surface>
  );
}
