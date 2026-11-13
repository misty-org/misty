// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useCallback, useSyncExternalStore } from "react";
import { refreshCachedResource, useCachedResource } from "@/api/cache/cached-resource";
import { cliApi, type CliSignInStatus, type CliVersionStatus } from "./api";

/**
 * The version status of each engine CLI, shared by Settings and first run, so probes aren't
 * repeated: the last answer is kept on this computer (`~/.misty/cache`), so a page paints it at
 * once, even after a relaunch, and refreshes behind it; readers share one probe in flight. Nothing
 * polls: a refresh happens when a page opens or the person asks (each probe starts
 * `<cli> --version` and asks npm for the latest version). None of it is secret: a version, and
 * whether the CLI says it is signed in.
 */

interface Probe {
  status: CliVersionStatus | null;
  signIn: CliSignInStatus | null;
}

/** What an install or update is doing, beside the probed status. */
interface UpdateState {
  updating: boolean;
  error: string | null;
}

const IDLE: UpdateState = { updating: false, error: null };
const updates = new Map<string, UpdateState>();
const listeners = new Set<() => void>();

/** Bumped by tests so each starts with nothing cached. */
let generation = 0;
const keyOf = (engine: string) =>
  generation ? `engine-cli/status:${engine}#${generation}` : `engine-cli/status:${engine}`;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function patch(engine: string, partial: Partial<UpdateState>) {
  updates.set(engine, { ...(updates.get(engine) ?? IDLE), ...partial });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function probe(engine: string): Promise<Probe> {
  const [status, signIn] = await Promise.all([
    cliApi.status(engine),
    cliApi.signedIn(engine).catch(() => null),
  ]);
  // A good probe answers for the engine as it is now, so an older failure no longer applies.
  if (updates.get(engine)?.error) patch(engine, { error: null });
  return { status, signIn };
}

/** Probes an engine's version and sign-in afresh, such as after an install or a sign-in. */
export function refreshCliStatus(engine: string): Promise<void> {
  return refreshCachedResource(keyOf(engine), () => probe(engine), "device").then(
    () => undefined,
    () => undefined,
  );
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
  /** A probe is in flight; a cached status stays visible meanwhile. */
  loading: boolean;
  error: string | null;
  updating: boolean;
  refresh: () => void;
  update: (runId: string) => Promise<void>;
}

export function useCliVersionStatus(engine: string): CliVersionStatusView {
  const resource = useCachedResource(keyOf(engine), () => probe(engine), { persist: "device" });
  const local = useSyncExternalStore(subscribe, () => updates.get(engine) ?? IDLE);
  return {
    status: resource.data?.status ?? null,
    signIn: resource.data?.signIn ?? null,
    loading: resource.loading || resource.refreshing,
    error: local.error ?? (resource.error ? errorText(resource.error) : null),
    updating: local.updating,
    refresh: useCallback(() => void refreshCliStatus(engine), [engine]),
    update: useCallback((runId: string) => update(engine, runId), [engine]),
  };
}

/** Starts over with nothing cached; tests only. */
export function resetCliStatusForTests() {
  generation += 1;
  updates.clear();
}
