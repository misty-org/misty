import { ChevronLeft, ChevronRight, File, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { libraryApi as spacesApi } from "./LibraryRuntime";
import { LibraryError as SystemErrorActivity } from "./LibraryRuntime";
import type { LibraryDiscoveryGroup, SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Pressable,
} from "@/shared/ui";

import { libraryItemMIME } from "./SpaceLibraryPrimitives";

export function LibraryMemoryPlayback({
  spaceId,
  group,
  items,
  onClose,
}: {
  spaceId: string;
  group: LibraryDiscoveryGroup;
  items: SpaceLibraryItem[];
  onClose: () => void;
}) {
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [contentUrl, setContentUrl] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [contentError, setContentError] = useState("");
  const item = items[index] ?? null;
  const mimeType = item ? libraryItemMIME(item) : "application/octet-stream";
  const isVideo = mimeType.startsWith("video/");
  const isVisualImage =
    mimeType.startsWith("image/") ||
    (!isVideo && Number(item?.file.intrinsic_metadata.width ?? 0) > 0);

  useEffect(() => {
    let current = true;
    let objectUrl = "";
    setContentUrl("");
    setContentError("");
    if (!item)
      return () => {
        current = false;
      };
    const request = isVisualImage
      ? spacesApi
          .libraryPreview(spaceId, item.id, "", item.version)
          .catch(() => spacesApi.libraryContent(spaceId, item.id))
      : spacesApi.libraryContent(spaceId, item.id);
    void request
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setContentUrl(objectUrl);
      })
      .catch(() => current && setContentError("This item could not be played."));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isVisualImage, item, spaceId]);

  useEffect(() => {
    let current = true;
    let objectUrl = "";
    setMusicUrl("");
    if (!group.music_item_id)
      return () => {
        current = false;
      };
    void spacesApi
      .libraryContent(spaceId, group.music_item_id)
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setMusicUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [group.music_item_id, spaceId]);

  useEffect(() => {
    if (!playing || isVideo || !contentUrl || items.length < 2) return;
    const timer = window.setTimeout(
      () => setIndex((current) => (current + 1) % items.length),
      (group.playback_seconds ?? 4.5) * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [contentUrl, group.playback_seconds, isVideo, items.length, playing]);

  useEffect(() => {
    if (!musicRef.current) return;
    if (playing) void musicRef.current.play().catch(() => undefined);
    else musicRef.current.pause();
  }, [musicUrl, playing]);

  if (!item) return null;
  const previous = () => setIndex((current) => (current - 1 + items.length) % items.length);
  const next = () => setIndex((current) => (current + 1) % items.length);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[calc(100dvh-28px)] max-h-[calc(100dvh-28px)] w-screen max-w-none flex-col gap-0 rounded-none border-0 bg-charcoal-workspace p-0 text-cream-bright sm:max-w-none [&>button]:right-5 [&>button]:top-5 [&>button]:text-cream-bright"
        onKeyDown={(event) => {
          if (
            (event.target as HTMLElement).matches(
              "button, input, textarea, select, [contenteditable='true']",
            )
          )
            return;
          if (event.key === "ArrowLeft") previous();
          else if (event.key === "ArrowRight") next();
          else if (event.key === " ") {
            event.preventDefault();
            setPlaying((current) => !current);
          }
        }}
      >
        <div className="flex items-center gap-1 px-5 pt-4">
          {items.map((candidate, candidateIndex) => (
            <Pressable
              className="h-1 flex-1 overflow-hidden rounded-full bg-charcoal-active"
              key={candidate.id}
              onClick={() => setIndex(candidateIndex)}
              aria-label={`Show item ${candidateIndex + 1}`}
            >
              <span
                className={`block h-full bg-charcoal-active transition-[width] duration-300 ${candidateIndex < index ? "w-full" : candidateIndex === index ? "w-1/2" : "w-0"}`}
              />
            </Pressable>
          ))}
        </div>
        <header className="px-5 py-4 pr-16">
          <DialogTitle className="truncate text-base text-cream-bright">{group.title}</DialogTitle>
          <DialogDescription className="mt-1 truncate text-xs text-cream-bright/55">
            {group.subtitle}
          </DialogDescription>
        </header>
        <main className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-charcoal-workspace">
          {musicUrl ? (
            <audio ref={musicRef} className="hidden" src={musicUrl} autoPlay={playing} loop />
          ) : null}
          {contentUrl ? (
            isVideo ? (
              <video
                className="max-h-full max-w-full object-contain"
                key={`${item.id}:${playing}`}
                src={contentUrl}
                autoPlay={playing}
                controls={false}
                muted={Boolean(musicUrl)}
                playsInline
                onEnded={next}
              />
            ) : isVisualImage ? (
              <img
                className="max-h-full max-w-full object-contain"
                src={contentUrl}
                alt={item.display_name}
              />
            ) : (
              <div className="grid place-items-center gap-3 text-cream-bright/60">
                <File size={48} />
                <span className="text-sm">{item.display_name}</span>
              </div>
            )
          ) : (
            <>
              {contentError ? (
                <SystemErrorActivity
                  error={contentError}
                  scope={`library:playback:${spaceId}:${item.id}`}
                  title="Library item could not be played"
                  target={{ kind: "route", href: `/spaces/${encodeURIComponent(spaceId)}/library` }}
                />
              ) : null}
              <div className="text-sm text-cream-bright/50">
                {contentError ? "Open Activity for details." : "Loading…"}
              </div>
            </>
          )}
          {items.length > 1 ? (
            <>
              <IconButton
                variant="overlay"
                shape="round"
                size="lg"
                label="Previous"
                className="absolute left-5 opacity-70 hover:opacity-100"
                onClick={previous}
              >
                <ChevronLeft size={22} />
              </IconButton>
              <IconButton
                variant="overlay"
                shape="round"
                size="lg"
                label="Next"
                className="absolute right-5 opacity-70 hover:opacity-100"
                onClick={next}
              >
                <ChevronRight size={22} />
              </IconButton>
            </>
          ) : null}
          <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-charcoal-workspace px-4 py-2 ">
            <IconButton label="Previous" onClick={previous}>
              <SkipBack size={17} />
            </IconButton>
            <IconButton
              variant="primary"
              shape="round"
              size="lg"
              label={playing ? "Pause" : "Play"}
              onClick={() => setPlaying((current) => !current)}
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </IconButton>
            <IconButton label="Next" onClick={next}>
              <SkipForward size={17} />
            </IconButton>
          </div>
        </main>
        <footer className="px-5 py-3 text-center">
          <p className="m-0 truncate text-xs text-cream-bright/70">
            {item.display_name} · {index + 1} of {items.length}
          </p>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
