import { useEffect, useRef } from "react";

export function AppWallpaperVideo(props: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // React does not reliably set the muted *property* from the JSX attribute,
    // and browsers/webviews only allow autoplay for genuinely muted video — so
    // enforce it here, otherwise autoplay is blocked and the wallpaper never
    // starts.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    let canceled = false;
    const play = () => {
      if (canceled) return;
      const started = video.play();
      if (started && typeof started.catch === "function") {
        // Autoplay can reject transiently (e.g. before data is ready); the
        // event listeners below retry, so a rejection here is safe to ignore.
        started.catch(() => undefined);
      }
    };

    play();

    // A wallpaper must always be playing. Resume it whenever it stalls: if it
    // pauses for any reason, ends (loop backstop), becomes playable, or the tab
    // regains visibility.
    const resume = () => play();
    const onEnded = () => {
      video.currentTime = 0;
      play();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") play();
    };

    // Fallback for environments whose autoplay policy still requires a user
    // gesture (e.g. a webview built before autoplay was enabled): the very first
    // interaction anywhere starts playback, then these listeners remove
    // themselves so they never interfere again.
    const gestureEvents = ["pointerdown", "keydown", "touchstart"] as const;
    const onFirstGesture = () => {
      play();
      for (const type of gestureEvents) {
        document.removeEventListener(type, onFirstGesture, true);
      }
    };

    video.addEventListener("pause", resume);
    video.addEventListener("ended", onEnded);
    video.addEventListener("stalled", resume);
    video.addEventListener("loadeddata", resume);
    video.addEventListener("canplay", resume);
    document.addEventListener("visibilitychange", onVisibility);
    for (const type of gestureEvents) {
      document.addEventListener(type, onFirstGesture, true);
    }

    return () => {
      canceled = true;
      video.removeEventListener("pause", resume);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("stalled", resume);
      video.removeEventListener("loadeddata", resume);
      video.removeEventListener("canplay", resume);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const type of gestureEvents) {
        document.removeEventListener(type, onFirstGesture, true);
      }
    };
  }, [props.src]);

  return (
    <video
      ref={videoRef}
      key={props.src}
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
      src={props.src}
      tabIndex={-1}
    />
  );
}
