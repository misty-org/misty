// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { listen, performanceApi } from "./nativeApi";
import { performanceRecorder, type PerformanceContext } from "./diagnostics";
import { startPerformanceMonitor } from "./monitor";

let enabled: boolean | null = null;
let context: (() => PerformanceContext) | undefined;
let stop: (() => void) | undefined;
let generation = 0;
let revision = 0;
const subscribers = new Set<() => void>();

export function getPerformancePreference() {
  return enabled;
}
export function subscribePerformancePreference(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

function apply(enabledNext: boolean) {
  enabled = enabledNext;
  if (!enabledNext) {
    stop?.();
    stop = undefined;
  }
  performanceRecorder.setEnabled(enabledNext);
  if (enabledNext && context && !stop) stop = startPerformanceMonitor(context);
  subscribers.forEach((callback) => callback());
}

export async function setPerformanceEnabled(value: boolean) {
  const currentGeneration = generation;
  const currentRevision = ++revision;
  const saved = await performanceApi.setEnabled(value);
  if (generation === currentGeneration && revision === currentRevision) apply(saved);
}

export async function synchronizePerformancePreference() {
  const currentGeneration = generation;
  const currentRevision = ++revision;
  const saved = await performanceApi.enabled();
  if (generation === currentGeneration && revision === currentRevision) apply(saved);
}

export function initializePerformancePreference(readContext: () => PerformanceContext) {
  generation += 1;
  context = readContext;
  enabled = null;
  performanceRecorder.setEnabled(false);
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    try {
      const remove = await listen<{ enabled: boolean }>(
        "performance-diagnostics-enabled",
        (event) => {
          if (disposed) return;
          revision += 1;
          apply(event.payload.enabled);
        },
      );
      if (disposed) {
        remove();
        return;
      }
      unlisten = remove;
    } catch {}
    try {
      if (!disposed) await synchronizePerformancePreference();
    } catch {}
  })();
  return () => {
    if (disposed) return;
    generation += 1;
    disposed = true;
    unlisten?.();
    stop?.();
    stop = undefined;
    context = undefined;
    performanceRecorder.setEnabled(false);
  };
}
