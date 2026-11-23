// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useCallback, useSyncExternalStore } from "react";
import {
  refreshCachedResource,
  setCachedResource,
  useCachedResource,
  useCachedResources,
} from "@/api/cache/cached_resource";
import { cliApi, type CliSignInStatus, type CliVersionStatus } from "./api";

interface Probe {
  status: CliVersionStatus | null;
  signIn: CliSignInStatus | null;
}

interface UpdateState {
  updating: boolean;
  error: string | null;
}

const IDLE: UpdateState = { updating: false, error: null };
const updates = new Map<string, UpdateState>();
const listeners = new Set<() => void>();

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
  if (updates.get(engine)?.error) patch(engine, { error: null });
  return { status, signIn };
}

export function refreshCliStatus(engine: string): Promise<void> {
  return refreshCachedResource(keyOf(engine), () => probe(engine), "device").then(
    () => undefined,
    () => undefined,
  );
}

export function noteCliStatus(status: CliVersionStatus) {
  setCachedResource<Probe>(
    keyOf(status.engine),
    (previous) => ({ status, signIn: previous?.signIn ?? null }),
    "device",
  );
}

export async function updateCli(engine: string, runId: string): Promise<void> {
  return update(engine, runId);
}

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
  const resource = useCachedResource(engine ? keyOf(engine) : null, () => probe(engine), {
    persist: "device",
  });
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

export function useCliStatuses(
  engines: readonly string[],
  options: { probe?: boolean } = {},
): {
  statuses: Record<string, CliVersionStatus | null>;
  settled: boolean;
} {
  const keys = engines.map(keyOf);
  const read = useCachedResources<Probe>(keys, (key) => probe(engines[keys.indexOf(key)] ?? key), {
    persist: "device",
    load: options.probe ?? true,
  });
  const statuses: Record<string, CliVersionStatus | null> = {};
  let settled = true;
  engines.forEach((engine, index) => {
    const entry = read[keys[index]];
    statuses[engine] = entry?.data?.status ?? null;
    if (!entry?.data && !entry?.error) settled = false;
  });
  return { statuses, settled };
}

export const hasCliUpdate = (status: CliVersionStatus | null | undefined) =>
  Boolean(status?.installed && status.updateAvailable && status.updateKind);

export function resetCliStatusForTests() {
  generation += 1;
  updates.clear();
}
