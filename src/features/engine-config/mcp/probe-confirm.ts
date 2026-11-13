// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Asks before checking MCP config from inside a folder (`McpConfigEntry.workspaceFile`).
 *
 * These config files sit in the folder (`.mcp.json`, `.codex/config.toml`, `.omp/mcp.json` …)
 * and can arrive with a repository; a check really starts their commands or connects to their
 * addresses. So they're never checked on their own (probe-store's `autoProbeEligible`), and a
 * manual check first fetches the full command or address with `engine_mcp_probe_plan` for the
 * person to see, and runs only once they agree. The agreement is bound to the plan's fingerprint
 * (`McpProbePlan.fingerprint`, a hash of the whole target): the plan is read again before every
 * check, an unchanged fingerprint isn't asked about again, and a changed one (`git pull`, an
 * agent editing the file, even before the list refreshes) is. The check carries the confirmed
 * fingerprint, native code refuses a mismatch (`conflict`), and the caller then calls
 * `forgetProbeConfirm`.
 *
 * `McpProbeConfirmHost` shows the request and resolves it on an answer; concurrent requests queue
 * one after another rather than replacing each other.
 */
import { mcpApi } from "./api";
import type { McpConfigEntry, McpProbePlan } from "./types";

interface ProbeConfirmItem {
  entry: McpConfigEntry;
  /** null: the plan could not be read; the dialog says so. */
  plan: McpProbePlan | null;
}

let pending: ((ok: boolean) => void) | null = null;
/** Stable snapshot for useSyncExternalStore (a new object only on change). */
let snapshot: { items: ProbeConfirmItem[] } | null = null;
const listeners = new Set<() => void>();
/** confirmKey → fingerprint of the plan the user confirmed. */
const confirmed = new Map<string, string>();
let chain: Promise<unknown> = Promise.resolve();

function emit() {
  for (const cb of listeners) cb();
}

function confirmKey(entry: McpConfigEntry, workspace: string | null): string {
  return `${workspace ?? ""}\u0000${entry.id}`;
}

/** The fingerprint to send with this entry's probe, if confirmed. */
export function confirmedFingerprint(
  entry: McpConfigEntry,
  workspace: string | null,
): string | undefined {
  return confirmed.get(confirmKey(entry, workspace));
}

/** Drop a confirmation the backend rejected as stale (`conflict`). */
export function forgetProbeConfirm(entry: McpConfigEntry, workspace: string | null) {
  confirmed.delete(confirmKey(entry, workspace));
}

/** useSyncExternalStore wiring for McpProbeConfirmHost. */
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
  // Re-read every plan: the list may be stale while the file changed.
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

/** Resolve true once the user agreed to run these workspace servers. */
export function confirmWorkspaceProbe(
  entries: McpConfigEntry[],
  workspace: string | null,
): Promise<boolean> {
  if (entries.length === 0) return Promise.resolve(true);
  const asked = chain.catch(() => undefined).then(() => ask(entries, workspace));
  chain = asked;
  return asked;
}
