import { hasTauriInternals } from "@/shared/platform/tauri";
import { useCallback, useEffect, useRef, useState } from "react";

const APP_ZOOM_STORAGE_KEY = "misty.app.zoom";
export const appZoomDefault = 1;
/**
 * 100% renders at 1: the page zoom is the person's own and nothing else. The step up the type,
 * controls and rows read best at (once a hidden 1.1× page zoom) is in the CSS now: the main
 * window's root is 110% (src/styles/App.css) and every size is in rem, so it grows with it.
 */
export const appZoomBaseline = 1;
/** The render scale for a zoom, the factor the webview's page zoom is set to. */
export function appZoomRenderScale(zoom: number): number {
  return Math.round(zoom * appZoomBaseline * 1000) / 1000;
}
/**
 * Saved zooms keep the unit they were first written in, when 100% was a 1.1× page zoom, so a
 * zoom someone chose before keeps its percentage: 1.1 saved is 100%, 1.32 is 120%.
 */
const storedZoomUnit = 1.1;
/** What a zoom is saved as, in the storage and in the device preference. */
export const appZoomStoredDefault = storedZoomUnit;
export function appZoomToStoredScale(zoom: number): number {
  return Math.round(zoom * storedZoomUnit * 1000) / 1000;
}
export function appZoomFromStoredScale(scale: number): number {
  if (scale === 1) return appZoomDefault;
  return clampAppZoom(scale / storedZoomUnit);
}
export const appZoomMin = 0.8;
export const appZoomMax = 2;
export const appZoomStep = 0.1;

let zoomApplySequence = 0;
let appliedAppZoom = loadStoredAppZoom();

export const appZoomChangedEvent = "misty:app-zoom-changed";

export function getAppliedAppZoom(): number {
  return appliedAppZoom;
}

/** Native child bounds must use physical renderer scale, not the displayed UI percentage. */
export function getAppliedAppRenderScale(): number {
  return appZoomRenderScale(appliedAppZoom);
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
  applyAppZoom(clamped);
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
    setZoom(appZoomDefault);
  }, []);

  useEffect(() => {
    applyAppZoom(zoom);
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

function applyAppZoom(zoom: number): void {
  zoom = clampAppZoom(zoom);
  const applySequence = ++zoomApplySequence;
  document.documentElement.dataset.appZoom = String(Math.round(zoom * 100));
  appliedAppZoom = zoom;
  window.dispatchEvent(new Event(appZoomChangedEvent));

  if (hasTauriInternals()) {
    // CSS zoom changes the renderer's layout coordinate system and breaks the
    // shell/native-child-webview geometry. The desktop app must use WKWebView's
    // page zoom API; clearing this first also repairs hot-reloaded sessions that
    // previously received the CSS fallback.
    clearCssZoom();
    void applyNativeZoom(appZoomRenderScale(zoom), applySequence);
    return;
  }

  // Keep web previews usable without pretending this is the desktop path.
  applyCssZoom(appZoomRenderScale(zoom));
}

async function applyNativeZoom(zoom: number, applySequence: number): Promise<void> {
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    if (applySequence !== zoomApplySequence) return;
    await getCurrentWebview().setZoom(zoom);
    // The first notification updates UI state before the async native call.
    // Measure embedded views again once the renderer's CSS viewport matches
    // the new scale; otherwise their bounds can retain the previous viewport.
    if (applySequence === zoomApplySequence) {
      window.dispatchEvent(new Event(appZoomChangedEvent));
    }
  } catch (error) {
    if (applySequence === zoomApplySequence) {
      console.error("Unable to apply native app zoom", error);
    }
  }
}

function loadStoredAppZoom(): number {
  if (typeof window === "undefined") return appZoomDefault;
  try {
    const raw = window.localStorage.getItem(APP_ZOOM_STORAGE_KEY);
    if (!raw) return appZoomDefault;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? appZoomFromStoredScale(parsed) : appZoomDefault;
  } catch {
    return appZoomDefault;
  }
}

function saveStoredAppZoom(zoom: number): void {
  try {
    if (zoom === appZoomDefault) window.localStorage.removeItem(APP_ZOOM_STORAGE_KEY);
    else window.localStorage.setItem(APP_ZOOM_STORAGE_KEY, String(appZoomToStoredScale(zoom)));
  } catch {
    // Browser privacy modes can disable localStorage; zoom still works for the session.
  }
}

function clampAppZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return appZoomDefault;
  const rounded = Math.round(zoom * 10) / 10;
  return Math.min(appZoomMax, Math.max(appZoomMin, rounded));
}

function applyCssZoom(zoom: number): void {
  const bodyStyle = document.body.style as CSSStyleDeclaration & { zoom?: string };
  bodyStyle.zoom = String(zoom);
}

function clearCssZoom(): void {
  const bodyStyle = document.body.style as CSSStyleDeclaration & { zoom?: string };
  bodyStyle.zoom = "";
}
