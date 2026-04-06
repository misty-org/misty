import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { safeTauriAssetUrl } from "@/shared/tauri";
import { useMediaViewerStore } from "../../../stores/useMediaViewerStore";

export function MediaSearchViewer() {
  const result = useMediaViewerStore((state) => state.result);
  const close = useMediaViewerStore((state) => state.close);
  const playerRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => setPlaying(false), [result]);

  if (!result || !result.match?.mediaSegmentId) return null;

  const startSeconds = (result.match.mediaStartMs ?? 0) / 1000;
  const isVideo = result.match.mediaType === "video";
  const common = {
    ref: (node: HTMLVideoElement | HTMLAudioElement | null) => {
      playerRef.current = node;
    },
    src: safeTauriAssetUrl(result.entry.path),
    controls: true,
    autoPlay: true,
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      event.currentTarget.currentTime = startSeconds;
      void event.currentTarget.play().catch(() => undefined);
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
  };

  const togglePlayback = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused) void player.play();
    else player.pause();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="grid max-h-[90vh] w-[min(1050px,94vw)] max-w-none grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden bg-card p-0 text-card-foreground">
        <DialogHeader className="sr-only">
          <DialogTitle>{result.entry.name}</DialogTitle>
          <DialogDescription>
            Media search result at {formatTime(result.match.mediaStartMs ?? 0)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-[240px] place-items-center overflow-hidden bg-black">
          {isVideo ? (
            <video {...common} className="max-h-[68vh] max-w-full" />
          ) : (
            <audio {...common} className="w-[min(720px,88vw)]" />
          )}
        </div>
        <div className="grid gap-3 border-t border-border p-5">
          <div className="flex items-start gap-3">
            <Button
              size="icon"
              type="button"
              onClick={togglePlayback}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </Button>
            <div className="min-w-0">
              <h2 className="m-0 truncate text-lg font-semibold">{result.entry.name}</h2>
              <p className="m-0 mt-1 text-sm text-muted-foreground">
                {formatTime(result.match.mediaStartMs ?? 0)} ·{" "}
                {result.match.mediaMatchKind === "spoken" ? "Spoken audio" : "Visual scene"}
              </p>
            </div>
          </div>
          {result.match.description ? (
            <p className="m-0 text-sm leading-6 text-muted-foreground">
              {result.match.description}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
