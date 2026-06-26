import { useCallback, useEffect, useRef, useState } from "react";

const APP_ZOOM_STORAGE_KEY = "misty.app.zoom";
const appZoomMin = 0.5;
const appZoomMax = 2;
const appZoomStep = 0.1;

let nativeZoomSupported: boolean | null = null;
let zoomApplySequence = 0;

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

  useEffect(() => () => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

      if (isZoomInKey(event)) {
        event.preventDefault();
        zoomIn();
      } else if (isZoomOutKey(event)) {
        event.preventDefault();
        zoomOut();
      } else if (isZoomResetKey(event)) {
        event.preventDefault();
        resetZoom();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetZoom, zoomIn, zoomOut]);

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

  if (nativeZoomSupported !== false) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(zoom);
      if (applySequence !== zoomApplySequence) return;
      nativeZoomSupported = true;
      clearCssZoomFallback();
      return;
    } catch {
      nativeZoomSupported = false;
    }
  }

  if (applySequence !== zoomApplySequence) return;
  applyCssZoomFallback(zoom);
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

function isZoomInKey(event: KeyboardEvent): boolean {
  return event.key === "+" || event.key === "=" || event.code === "Equal" || event.code === "NumpadAdd";
}

function isZoomOutKey(event: KeyboardEvent): boolean {
  return event.key === "-" || event.key === "_" || event.code === "Minus" || event.code === "NumpadSubtract";
}

function isZoomResetKey(event: KeyboardEvent): boolean {
  return event.key === "0" || event.code === "Digit0" || event.code === "Numpad0";
}

function applyCssZoomFallback(zoom: number): void {
  const bodyStyle = document.body.style as CSSStyleDeclaration & { zoom?: string };
  bodyStyle.zoom = String(zoom);
  document.documentElement.style.setProperty("--misty-app-zoom", String(zoom));
}

function clearCssZoomFallback(): void {
  const bodyStyle = document.body.style as CSSStyleDeclaration & { zoom?: string };
  bodyStyle.zoom = "";
  document.documentElement.style.removeProperty("--misty-app-zoom");
}
