// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { cliApi, type CliSignInStatus, type CliVersionStatus } from "./api";

/**
 * This session's version status of each engine CLI, shared by Settings and first run, so probes
 * aren't repeated: switching pages repaints from the cache and refreshes behind it, and readers
 * share one probe in flight. Nothing polls: a refresh happens when a page opens or the person asks
 * (each probe starts `<cli> --version` and asks npm for the latest version).
 */

interface Entry {
  status: CliVersionStatus | null;
  signIn: CliSignInStatus | null;
  /** A probe is in flight; a cached status stays visible meanwhile. */
  loading: boolean;
  error: string | null;
  updating: boolean;
  inflight: Promise<void> | null;
}

const EMPTY: Entry = {
  status: null,
  signIn: null,
  loading: false,
  error: null,
  updating: false,
  inflight: null,
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function patch(engine: string, partial: Partial<Entry>) {
  entries.set(engine, { ...(entries.get(engine) ?? EMPTY), ...partial });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Probes (or shares the probe in flight for) an engine's version and sign-in. */
export function refreshCliStatus(engine: string): Promise<void> {
  const current = entries.get(engine) ?? EMPTY;
  if (current.inflight) return current.inflight;
  const task = (async () => {
    try {
      const [status, signIn] = await Promise.all([
        cliApi.status(engine),
        cliApi.signedIn(engine).catch(() => null),
      ]);
      patch(engine, { status, signIn, loading: false, error: null });
    } catch (e) {
      patch(engine, { loading: false, error: errorText(e) });
    }
  })();
  patch(engine, { loading: true, inflight: task });
  return task.finally(() => patch(engine, { inflight: null }));
}

/** Installs or updates an engine, then probes again. `runId` scopes the streamed output. */
async function update(engine: string, runId: string): Promise<void> {
  patch(engine, { updating: true, error: null });
  try {
    await cliApi.update(engine, runId);
  } catch (e) {
    patch(engine, { updating: false, error: errorText(e) });
    throw e;
  }
  patch(engine, { updating: false });
  await refreshCliStatus(engine);
}

export interface CliVersionStatusView {
  status: CliVersionStatus | null;
  signIn: CliSignInStatus | null;
  loading: boolean;
  error: string | null;
  updating: boolean;
  refresh: () => void;
  update: (runId: string) => Promise<void>;
}

export function useCliVersionStatus(engine: string): CliVersionStatusView {
  useEffect(() => {
    void refreshCliStatus(engine);
  }, [engine]);
  const entry = useSyncExternalStore(subscribe, () => entries.get(engine) ?? EMPTY);
  return {
    status: entry.status,
    signIn: entry.signIn,
    loading: entry.loading,
    error: entry.error,
    updating: entry.updating,
    refresh: useCallback(() => void refreshCliStatus(engine), [engine]),
    update: useCallback((runId: string) => update(engine, runId), [engine]),
  };
}

/** Clears the cache; tests only. */
export function resetCliStatusForTests() {
  entries.clear();
}
