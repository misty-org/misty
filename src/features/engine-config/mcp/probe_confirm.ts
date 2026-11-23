// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { mcpApi } from "./api";
import type { McpConfigEntry, McpProbePlan } from "./types";

interface ProbeConfirmItem {
  entry: McpConfigEntry;
  plan: McpProbePlan | null;
}

let pending: ((ok: boolean) => void) | null = null;
let snapshot: { items: ProbeConfirmItem[] } | null = null;
const listeners = new Set<() => void>();
const confirmed = new Map<string, string>();
let chain: Promise<unknown> = Promise.resolve();

function emit() {
  for (const cb of listeners) cb();
}

function confirmKey(entry: McpConfigEntry, workspace: string | null): string {
  return `${workspace ?? ""}\u0000${entry.id}`;
}

export function confirmedFingerprint(
  entry: McpConfigEntry,
  workspace: string | null,
): string | undefined {
  return confirmed.get(confirmKey(entry, workspace));
}

export function forgetProbeConfirm(entry: McpConfigEntry, workspace: string | null) {
  confirmed.delete(confirmKey(entry, workspace));
}

export function subscribeProbeConfirm(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function currentProbeConfirm(): { items: ProbeConfirmItem[] } | null {
  return snapshot;
}

export function answerProbeConfirm(ok: boolean) {
  const resolve = pending;
  pending = null;
  snapshot = null;
  emit();
  resolve?.(ok);
}

async function ask(entries: McpConfigEntry[], workspace: string | null): Promise<boolean> {
  const planned = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      plan: await mcpApi.probePlan(entry, workspace).catch(() => null),
    })),
  );
  const items = planned.filter(
    ({ entry, plan }) =>
      !plan?.fingerprint || confirmed.get(confirmKey(entry, workspace)) !== plan.fingerprint,
  );
  if (items.length === 0) return true;
  const ok = await new Promise<boolean>((resolve) => {
    pending = resolve;
    snapshot = { items };
    emit();
  });
  if (ok) {
    for (const { entry, plan } of items) {
      if (plan?.fingerprint) confirmed.set(confirmKey(entry, workspace), plan.fingerprint);
    }
  }
  return ok;
}

export function confirmWorkspaceProbe(
  entries: McpConfigEntry[],
  workspace: string | null,
): Promise<boolean> {
  if (entries.length === 0) return Promise.resolve(true);
  const asked = chain.catch(() => undefined).then(() => ask(entries, workspace));
  chain = asked;
  return asked;
}
