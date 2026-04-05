import { useLayoutEffect, useRef } from "react";

const playbackRetryDelaysMs = [0, 100, 500, 1_000, 2_000] as const;

export function AppWallpaperVideo(props: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let retryIndex = 0;
    let retryTimer: number | undefined;

    const cancelRetry = () => {
      if (retryTimer === undefined) return;
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
    };

    const prepareForPlayback = () => {
      video.defaultMuted = true;
      video.muted = true;
      video.volume = 0;
      video.controls = false;
      video.setAttribute("muted", "");
      video.setAttribute("webkit-playsinline", "");
    };

    const playbackStarted = () => {
      retryIndex = 0;
      cancelRetry();
    };

    const schedulePlayback = (restartRetries = false) => {
      if (disposed) return;
      if (!video.paused) {
        retryIndex = 0;
        cancelRetry();
        return;
      }

      if (restartRetries) {
        retryIndex = 0;
        cancelRetry();
      }
      if (retryTimer !== undefined) return;

      // WKWebView can reject play() for longer than the initial page load while
      // it restores a media session after a reload. Keep retrying at the capped
      // delay instead of permanently giving up before that restoration ends.
      const delay = playbackRetryDelaysMs[Math.min(retryIndex, playbackRetryDelaysMs.length - 1)];
      retryIndex += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        playImmediately();
      }, delay);
    };

    const playImmediately = () => {
      if (disposed || !video.paused) return;
      prepareForPlayback();
      try {
        void video.play().then(playbackStarted, () => schedulePlayback());
      } catch {
        schedulePlayback();
      }
    };

    const resumePlayback = () => {
      schedulePlayback(true);
    };

    prepareForPlayback();
    video.addEventListener("loadeddata", resumePlayback);
    video.addEventListener("canplay", resumePlayback);
    video.addEventListener("pause", resumePlayback);
    video.addEventListener("playing", playbackStarted);
    document.addEventListener("visibilitychange", resumePlayback);
    window.addEventListener("focus", resumePlayback);
    window.addEventListener("pageshow", resumePlayback);
    resumePlayback();

    return () => {
      disposed = true;
      cancelRetry();
      video.removeEventListener("loadeddata", resumePlayback);
      video.removeEventListener("canplay", resumePlayback);
      video.removeEventListener("pause", resumePlayback);
      video.removeEventListener("playing", playbackStarted);
      document.removeEventListener("visibilitychange", resumePlayback);
      window.removeEventListener("focus", resumePlayback);
      window.removeEventListener("pageshow", resumePlayback);
    };
  }, [props.src]);

  return (
    <video
      aria-hidden="true"
      autoPlay
      className="misty-app-wallpaper-video h-full w-full object-cover"
      controls={false}
      controlsList="nodownload noplaybackrate noremoteplayback"
      disablePictureInPicture
      disableRemotePlayback
      loop
      muted
      playsInline
      preload="auto"
      ref={videoRef}
      src={props.src}
      tabIndex={-1}
    />
  );
}
