import { Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  BrandIcon,
  cn,
  IconButton,
  MediaPlayerCard,
  OptionSelect,
  Surface,
  Text,
} from "@/shared/ui";
import { musicServices, pageWanted, useStudioMusic, type MusicService } from "./studioMusic";

/** The panel's place: the room's bottom right corner, clear of the team list and the chat bar. */
const musicPanelClass = cn(
  "absolute right-[calc(0.5rem+var(--window-chrome-right,0px))] bottom-2 z-[var(--stack-overlay)]",
  "flex w-96 max-w-[calc(100%-1rem)] flex-col gap-2 p-2",
);
/** Tall enough to browse the service, short of the room's top bar. */
const pageHeightClass = "h-[min(40rem,calc(100%-4.5rem))]";

/** How often the card asks the page what is playing while it shows. */
const MEDIA_MS = 1000;

const serviceLabel = (id: MusicService) =>
  musicServices.find((service) => service.id === id)?.label ?? "Music";

/**
 * The studio's music: the chosen service's own website over the panel's frame, signed in to by
 * the person, or the small player card for what it plays. The page is native and sits over
 * anything drawn in its frame, so it steps out of sight while the service list is open, and
 * waits out of sight until it has drawn. Hiding the panel keeps the music playing; the card's
 * close ends it.
 */
export function MusicPanel() {
  const view = useStudioMusic((state) => state.view);
  const error = useStudioMusic((state) => state.error);
  return (
    <Surface
      as="section"
      tone="scene-panel"
      radius="2xl"
      aria-label="Music"
      className={cn(musicPanelClass, view === "page" && pageHeightClass)}
      onKeyDown={(event) => {
        if (event.key === "Escape") useStudioMusic.getState().hide();
      }}
    >
      {view === "page" ? <MusicPage /> : <MusicCard />}
      {error ? (
        <Text size="meta" tone="muted" className="px-1">
          {error}
        </Text>
      ) : null}
    </Surface>
  );
}

/** The service's page: its picker, the way down to the card, and the frame the page covers. */
function MusicPage() {
  const service = useStudioMusic((state) => state.service);
  const live = useStudioMusic((state) => state.live);
  const wanted = useStudioMusic((state) =>
    pageWanted({ shown: state.shown, view: state.view, menuOpen: state.menuOpen, framed: true }),
  );
  const frame = useRef<HTMLElement>(null);

  useEffect(() => {
    const host = frame.current;
    if (!host || !wanted) return;
    const music = useStudioMusic.getState();
    music.setFramed(true);
    let pending = 0;
    const follow = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const rect = host.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        void useStudioMusic.getState().place({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
      });
    };
    follow();
    const watcher = new ResizeObserver(follow);
    watcher.observe(host);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(pending);
      watcher.disconnect();
      window.removeEventListener("resize", follow);
      // Gone from here (hidden, shrunk to the card, the list open, the studio left), the page
      // goes out of sight: the music goes on.
      useStudioMusic.getState().setFramed(false);
    };
    // A new service loads in the same frame.
  }, [service, wanted]);

  return (
    <>
      <header className="flex h-8 flex-none items-center gap-1">
        <OptionSelect
          aria-label="Music service"
          className="w-48"
          value={service}
          options={musicServices.map(({ id, label }) => ({
            value: id,
            label,
            icon: <BrandIcon brand={id} size={16} />,
          }))}
          onValueChange={(next) => useStudioMusic.getState().choose(next as MusicService)}
          onOpenChange={(open) => useStudioMusic.getState().setMenuOpen(open)}
        />
        {live ? (
          <IconButton
            className="ml-auto"
            label="Show player"
            onClick={() => useStudioMusic.getState().collapse()}
          >
            <Minimize2 aria-hidden="true" />
          </IconButton>
        ) : null}
      </header>
      {/* The service's page is laid over this frame. */}
      <Surface ref={frame} tone="page" radius="lg" className="min-h-0 flex-1" />
    </>
  );
}

/** The player card: what the page plays, with its controls, read from the page while it shows. */
function MusicCard() {
  const service = useStudioMusic((state) => state.on ?? state.service);
  const media = useStudioMusic((state) => state.media);

  useEffect(() => {
    const music = useStudioMusic.getState();
    void music.refresh();
    const timer = window.setInterval(() => void music.refresh(), MEDIA_MS);
    return () => window.clearInterval(timer);
  }, []);

  const music = useStudioMusic.getState();
  const label = serviceLabel(service);
  return (
    <MediaPlayerCard
      title={media?.title || label}
      detail={media?.artist || (media?.title ? label : undefined)}
      artwork={media?.artwork || undefined}
      source={<BrandIcon brand={service} size={16} />}
      playing={Boolean(media?.playing)}
      position={media?.position}
      length={media?.duration}
      muted={media?.muted}
      canPrevious={media?.canPrevious}
      canNext={media?.canNext}
      onPlay={() => music.act("play")}
      onPause={() => music.act("pause")}
      onPrevious={() => music.act("previoustrack")}
      onNext={() => music.act("nexttrack")}
      onSeek={media?.canSeek ? (seconds) => music.act("seekto", seconds) : undefined}
      onToggleMute={media ? () => music.toggleMute() : undefined}
      // The panel already pads it.
      className="p-0"
      actions={
        <>
          <IconButton label={`Open ${label}`} onClick={() => music.expand()}>
            <Maximize2 aria-hidden="true" />
          </IconButton>
          <IconButton label="Close player" onClick={() => void music.stop()}>
            <X aria-hidden="true" />
          </IconButton>
        </>
      }
    />
  );
}
