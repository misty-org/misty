import { useLayoutEffect, useRef } from "react";

const playbackRetryDelaysMs = [0, 100, 500, 1_000, 2_000] as const;
const playbackWatchdogIntervalMs = 1_000;
const stalledPlaybackChecksBeforeRestart = 2;

export function AppWallpaperVideo(props: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let playbackConfirmed = false;
    let lastCurrentTime = video.currentTime;
    let retryIndex = 0;
    let retryTimer: number | undefined;
    let stalledPlaybackChecks = 0;

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
      playbackConfirmed = true;
      retryIndex = 0;
      stalledPlaybackChecks = 0;
      cancelRetry();
    };

    const schedulePlayback = (restartRetries = false) => {
      if (disposed) return;
      if (playbackConfirmed && !video.paused) return;

      if (restartRetries) {
        playbackConfirmed = false;
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
      if (disposed || (playbackConfirmed && !video.paused)) return;
      prepareForPlayback();
      try {
        void video.play().then(
          () => {
            if (disposed) return;
            // A resolved play() promise is not enough on WKWebView startup.
            // Wait for `playing` or timeline progress before stopping retries.
            if (!playbackConfirmed) schedulePlayback();
          },
          () => schedulePlayback(),
        );
      } catch {
        schedulePlayback();
      }
    };

    const resumePlayback = () => {
      schedulePlayback(true);
    };

    const checkPlaybackProgress = () => {
      if (disposed) return;
      const currentTime = video.currentTime;
      const progressed = Math.abs(currentTime - lastCurrentTime) > 0.01;
      lastCurrentTime = currentTime;

      if (progressed && !video.paused) {
        playbackStarted();
        return;
      }
      if (video.paused) {
        stalledPlaybackChecks = 0;
        schedulePlayback();
        return;
      }

      stalledPlaybackChecks += 1;
      if (stalledPlaybackChecks < stalledPlaybackChecksBeforeRestart) {
        if (!playbackConfirmed) schedulePlayback();
        return;
      }

      // WKWebView can claim the element is playing while its media pipeline is
      // suspended at time zero. Cycling pause/play gives it a fresh attempt
      // without requiring a pointer or keyboard event from the user.
      playbackConfirmed = false;
      stalledPlaybackChecks = 0;
      video.pause();
      schedulePlayback(true);
    };

    prepareForPlayback();
    video.addEventListener("loadeddata", resumePlayback);
    video.addEventListener("canplay", resumePlayback);
    video.addEventListener("pause", resumePlayback);
    video.addEventListener("playing", playbackStarted);
    video.addEventListener("timeupdate", playbackStarted);
    document.addEventListener("visibilitychange", resumePlayback);
    window.addEventListener("focus", resumePlayback);
    window.addEventListener("pageshow", resumePlayback);
    const watchdogTimer = window.setInterval(checkPlaybackProgress, playbackWatchdogIntervalMs);
    resumePlayback();

    return () => {
      disposed = true;
      cancelRetry();
      window.clearInterval(watchdogTimer);
      video.removeEventListener("loadeddata", resumePlayback);
      video.removeEventListener("canplay", resumePlayback);
      video.removeEventListener("pause", resumePlayback);
      video.removeEventListener("playing", playbackStarted);
      video.removeEventListener("timeupdate", playbackStarted);
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
