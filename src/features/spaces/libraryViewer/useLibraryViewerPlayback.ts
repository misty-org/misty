import { useEffect, useRef } from "react";
import type { LibraryEditDefinition } from "@/models/types/features/spaces/types";
import type { LibraryAssetStack } from "@/models/interfaces/features/spaces/types";

const BOUNCE_STEP_SECONDS = 0.04;

/**
 * Applies edit settings to the <video> element and drives the bounce effect.
 *
 * Trim, speed and mute are properties of the element rather than the source, so
 * they are re-applied on every timeupdate. Bounce is played by stepping the
 * clip backwards frame by frame once forward playback ends.
 */
export function useLibraryViewerPlayback(options: {
  appliedEdit: LibraryEditDefinition;
  assetStack: LibraryAssetStack | null;
}) {
  const { appliedEdit, assetStack } = options;
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const bounceFrameRef = useRef(0);

  useEffect(() => () => window.cancelAnimationFrame(bounceFrameRef.current), []);

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

  const handleVideoEnded = () => {
    if (assetStack?.kind !== "live_photo" || assetStack.effect !== "bounce") return;
    const reverse = () => {
      const video = videoRef.current;
      if (!video) return;
      if (video.currentTime <= BOUNCE_STEP_SECONDS) {
        video.currentTime = 0;
        void video.play();
        return;
      }
      video.currentTime = Math.max(0, video.currentTime - BOUNCE_STEP_SECONDS);
      bounceFrameRef.current = window.requestAnimationFrame(reverse);
    };
    reverse();
  };

  return { videoRef, imageRef, handleVideoTime, handleVideoEnded };
}
