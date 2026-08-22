import { hasTauriInternals } from "@/shared/platform/tauri";
import { useCallback, useEffect, useRef, useState } from "react";

const APP_ZOOM_STORAGE_KEY = "misty.app.zoom";
const appZoomMin = 0.5;
const appZoomMax = 2;
const appZoomStep = 0.1;

let nativeZoomSupported: boolean | null = null;
let zoomApplySequence = 0;
let appliedAppZoom = loadStoredAppZoom();

export const appZoomChangedEvent = "misty:app-zoom-changed";

export function getAppliedAppZoom(): number {
  return appliedAppZoom;
}

/**
 * Sets the zoom from outside the keyboard shortcuts — currently the Appearance
 * settings row. Both paths write the same storage key and announce the result
 * on `appZoomChangedEvent`, so whichever one moved last, the other resyncs.
 */
export function setAppZoom(zoom: number): void {
  const clamped = clampAppZoom(zoom);
  if (clamped === appliedAppZoom) return;
  saveStoredAppZoom(clamped);
  void applyAppZoom(clamped);
}

/** Read-only view of the live zoom, for UI that displays but does not own it. */
export function useAppZoomValue(): number {
  const [zoom, setZoom] = useState(getAppliedAppZoom);
  useEffect(() => {
    const sync = () => setZoom(getAppliedAppZoom());
    sync();
    window.addEventListener(appZoomChangedEvent, sync);
    return () => window.removeEventListener(appZoomChangedEvent, sync);
  }, []);
  return zoom;
}

export function useAppZoom() {
  const [zoom, setZoom] = useState(loadStoredAppZoom);
  const [indicatorVisible, setIndicatorVisible] = useState(false);
  const didMountRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);

  const setClampedZoom = useCallback((nextZoom: number) => {
    setZoom((currentZoom) => {
      const clamped = clampAppZoom(nextZoom);
      return clamped === currentZoom ? currentZoom : clamped;
    });
  }, []);

  const zoomIn = useCallback(() => {
    setZoom((currentZoom) => clampAppZoom(currentZoom + appZoomStep));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((currentZoom) => clampAppZoom(currentZoom - appZoomStep));
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  useEffect(() => {
    void applyAppZoom(zoom);
    saveStoredAppZoom(zoom);

    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    setIndicatorVisible(true);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setIndicatorVisible(false);
    }, 900);
  }, [zoom]);

  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const sync = () => setClampedZoom(getAppliedAppZoom());
    window.addEventListener(appZoomChangedEvent, sync);
    return () => window.removeEventListener(appZoomChangedEvent, sync);
  }, [setClampedZoom]);

  return {
    indicatorVisible,
    resetZoom,
    setZoom: setClampedZoom,
    zoom,
    zoomIn,
    zoomOut,
    zoomPercent: Math.round(zoom * 100),
  };
}

async function applyAppZoom(zoom: number): Promise<void> {
  const applySequence = ++zoomApplySequence;
  document.documentElement.dataset.appZoom = String(Math.round(zoom * 100));

  if (nativeZoomSupported !== false && hasTauriInternals()) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(zoom);
      if (applySequence !== zoomApplySequence) return;
      nativeZoomSupported = true;
      appliedAppZoom = zoom;
      clearCssZoomFallback();
      window.dispatchEvent(new Event(appZoomChangedEvent));
      return;
    } catch {
      nativeZoomSupported = false;
    }
  }

  if (applySequence !== zoomApplySequence) return;
  applyCssZoomFallback(zoom);
  appliedAppZoom = zoom;
  window.dispatchEvent(new Event(appZoomChangedEvent));
}

function loadStoredAppZoom(): number {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(APP_ZOOM_STORAGE_KEY);
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampAppZoom(parsed) : 1;
}

function saveStoredAppZoom(zoom: number): void {
  try {
    if (zoom === 1) window.localStorage.removeItem(APP_ZOOM_STORAGE_KEY);
    else window.localStorage.setItem(APP_ZOOM_STORAGE_KEY, String(zoom));
  } catch {
    // Browser privacy modes can disable localStorage; zoom still works for the session.
  }
}

function clampAppZoom(zoom: number): number {
  const rounded = Math.round(zoom * 10) / 10;
  return Math.min(appZoomMax, Math.max(appZoomMin, rounded));
}

function applyCssZoomFallback(zoom: number): void {
  const bodyStyle = document.body.style as CSSStyleDeclaration & { zoom?: string };
  bodyStyle.zoom = String(zoom);
}

function clearCssZoomFallback(): void {
  const bodyStyle = document.body.style as CSSStyleDeclaration & { zoom?: string };
  bodyStyle.zoom = "";
}
