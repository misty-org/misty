import type { LibraryEditDefinition } from "@/api/spaces/dto/common";
import { useRef } from "react";

/**
 * Applies edit settings to the <video> element. Trim, speed and mute are
 * properties of the element rather than the source, so they are re-applied on
 * every timeupdate.
 */
export function useLibraryViewerPlayback(options: { appliedEdit: LibraryEditDefinition }) {
  const { appliedEdit } = options;
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const handleVideoTime = () => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = appliedEdit.playback_speed || 1;
    video.muted = appliedEdit.mute;
    const trim = appliedEdit.trim;
    if (!trim) return;
    if (video.currentTime < trim.start) video.currentTime = trim.start;
    if (video.currentTime >= trim.end) video.pause();
  };

  return { videoRef, imageRef, handleVideoTime };
}
