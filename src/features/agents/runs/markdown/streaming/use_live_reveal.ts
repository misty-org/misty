// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { StreamReveal } from "./stream_reveal";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(notify: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(reducedMotionQuery).matches),
    () => false,
  );
}

export function useLiveReveal(text: string | { text: string }, live: boolean): StreamReveal {
  const controller = useMemo(() => new StreamReveal(false), []);
  const reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    controller.update(
      typeof text === "string" ? text : text.text,
      live && !reducedMotion && !document.hidden,
    );
  }, [controller, text, live, reducedMotion]);
  useLayoutEffect(() => {
    const onVisibility = () => {
      if (document.hidden) controller.finish();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controller.finish();
      controller.cancel();
    };
  }, [controller]);
  return controller;
}
