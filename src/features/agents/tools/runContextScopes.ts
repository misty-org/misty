import type { AiInvocationDeviceContext } from "../runs/invocations/invocationTypes";
import { invoke } from "@/native/invoke";
import type { RunDeviceContext, RunEntry } from "./runContexts";
import { asContext, change } from "./runContexts";

const browserOnly = (capabilities: unknown) =>
  Array.isArray(capabilities) &&
  capabilities.length > 0 &&
  capabilities.every((item) => typeof item === "string" && item.startsWith("browser."));

/**
 * Reads tabs this computer opened for a run (`validateDeviceOpenedTabs`): each must be a browser tab
 * on that device with browser-only capabilities and its own grant. Null when any isn't.
 */
export function openedTabs(
  tabs: unknown,
  deviceId: string,
  count: number,
): AiInvocationDeviceContext[] | null {
  if (!Array.isArray(tabs) || tabs.length !== count || !deviceId) return null;
  const seen = new Set<string>();
  const out: AiInvocationDeviceContext[] = [];
  for (const raw of tabs as Array<Record<string, unknown>>) {
    const ref = typeof raw?.opaque_ref === "string" ? raw.opaque_ref.trim() : "";
    const metadata = raw?.metadata as Record<string, string | number | boolean> | undefined;
    if (
      raw?.device_id !== deviceId ||
      raw.kind !== "browser_tab" ||
      !ref ||
      ref.length > 256 ||
      seen.has(ref) ||
      !raw.run_grant ||
      !browserOnly(raw.capabilities) ||
      metadata?.app_id !== "browser"
    )
      return null;
    seen.add(ref);
    out.push({
      deviceId,
      kind: "browser_tab",
      opaqueRef: ref,
      displayName: typeof raw.display_name === "string" ? raw.display_name : "",
      capabilities: raw.capabilities as string[],
      metadata,
      runGrant: raw.run_grant as RunDeviceContext["runGrant"],
    });
  }
  return out;
}

/** The run's contexts as the crate reads them, which decide the step tools its catalog lists. */
function crateContexts(entry: RunEntry) {
  return entry.contexts.map((context) => ({
    device_id: context.deviceId,
    kind: context.kind,
    opaque_ref: context.opaqueRef,
    display_name: context.displayName,
    capabilities: context.capabilities,
    metadata: context.metadata,
  }));
}

/** Tells the run what it can reach now. A run the crate has finished has nothing to update. */
async function tellRun(entry: RunEntry | null) {
  if (!entry) return;
  await invoke("agent_run_contexts", {
    runId: entry.runId,
    contexts: crateContexts(entry),
  }).catch(() => undefined);
}

/**
 * Joins tabs to the run (`screen.open`, `browser.run`'s `opened`), working for the window that asked,
 * as a screen the person attached would. Returns the entry as it now stands, and the catalog lists the
 * tab's step tools from here on.
 */
export async function joinRunTabs(
  runId: string,
  tabs: AiInvocationDeviceContext[],
  extra: Record<string, string> = {},
): Promise<RunEntry | null> {
  const now = Date.now();
  let joined: RunEntry | null = null;
  await change((runs) => {
    const entry = runs[runId];
    if (!entry) return;
    const added = tabs
      .filter((tab) => !entry.contexts.some((item) => item.opaqueRef === tab.opaqueRef))
      .map((tab) => {
        const context = asContext(tab, now);
        context.metadata = { ...context.metadata, ...extra, window_label: entry.windowLabel };
        return context;
      });
    joined = { ...entry, contexts: [...entry.contexts, ...added], updatedAt: now };
    runs[runId] = joined;
  });
  await tellRun(joined);
  return joined;
}

/**
 * A chat's agent keeps its tabs from one turn to the next. Each turn is a run of its own, so a tab
 * the same agent opened earlier in the same chat joins this run when a call names it. Returns the
 * entry with the tab, or null when no earlier turn of this chat opened it.
 */
export async function adoptChatTab(entry: RunEntry, scopeId: string): Promise<RunEntry | null> {
  if (!entry.conversationId || !entry.agentId) return null;
  const now = Date.now();
  let joined: RunEntry | null = null;
  await change((runs) => {
    const current = runs[entry.runId];
    if (!current) return;
    const earlier = Object.values(runs)
      .filter(
        (run) =>
          run.runId !== current.runId &&
          run.conversationId === current.conversationId &&
          run.agentId === current.agentId &&
          run.account === current.account,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const run of earlier) {
      const tab = run.contexts.find(
        (item) =>
          item.opaqueRef === scopeId &&
          item.kind === "browser_tab" &&
          item.metadata.agentOwned === true &&
          Date.parse(item.expiresAt) > now,
      );
      if (!tab) continue;
      const context = { ...tab, metadata: { ...tab.metadata, window_label: current.windowLabel } };
      joined = { ...current, contexts: [...current.contexts, context], updatedAt: now };
      runs[current.runId] = joined;
      return;
    }
  });
  await tellRun(joined);
  return joined;
}

export async function leaveRunTab(runId: string, opaqueRef: string) {
  let left: RunEntry | null = null;
  await change((runs) => {
    const entry = runs[runId];
    if (!entry) return;
    left = {
      ...entry,
      contexts: entry.contexts.filter((item) => item.opaqueRef !== opaqueRef),
      updatedAt: Date.now(),
    };
    runs[runId] = left;
  });
  await tellRun(left);
}

const locks = new Map<string, Promise<unknown>>();

/** Calls made together (one per site) take turns, so each sees the tabs the one before it opened. */
export function withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
  const turn = (locks.get(runId) ?? Promise.resolve()).then(work, work);
  const settled = turn.catch(() => undefined);
  locks.set(runId, settled);
  void settled.then(() => {
    if (locks.get(runId) === settled) locks.delete(runId);
  });
  return turn;
}

export const contextAllows = (context: RunDeviceContext | undefined, capability: string) =>
  Boolean(context?.capabilities.includes(capability));

const live = (context: RunDeviceContext) => Date.parse(context.expiresAt) > Date.now();

/** The attached context a job for this scope and capability runs under, or nothing. */
export const contextFor = (entry: RunEntry, scopeId: string, capability: string) =>
  entry.contexts.find(
    (item) => item.opaqueRef === scopeId && live(item) && contextAllows(item, capability),
  );

/** `authorizeNativeAgentBrowserScope`: the exact target, rechecked before every call. */
export function browserScopeAllowed(entry: RunEntry, scopeId: string): boolean {
  if (!entry.agentId) return true;
  for (const item of entry.contexts) {
    if (item.opaqueRef !== scopeId) continue;
    if ((item.metadata.window_label ?? "") !== entry.windowLabel) return false;
    if (item.metadata.app_id === "browser") return true;
  }
  return false;
}

/** Where a scope runs: a browser page, the Misty window, or the desktop (`browserToolSurface`). */
export function browserToolSurface(entry: RunEntry, scopeId: string) {
  let surface: "browser" | "workspace" | "desktop" = "browser";
  for (const item of entry.contexts) {
    if (item.opaqueRef === scopeId && item.metadata.workspace_control === true) {
      surface = item.metadata.desktop_control === true ? "desktop" : "workspace";
    }
  }
  return surface;
}

/** The task whose lease guards a scope: the session's own for its tabs, else the request's. */
export function scopeTaskId(entry: RunEntry, scopeId: string): string {
  const task = entry.contexts.find((item) => item.opaqueRef === scopeId)?.metadata.task_id;
  return typeof task === "string" && task ? task : entry.taskId;
}

/** The grant a browser session opens under: the sending computer's own (`sessionTarget`). */
export const sessionTarget = (entry: RunEntry) =>
  entry.contexts.find(
    (item) =>
      item.kind === "workspace" &&
      live(item) &&
      item.metadata.source === "desktop" &&
      contextAllows(item, "browser.session"),
  );

/** The agent's own tabs on a device in this run, the first opened first. */
export const ownTabs = (entry: RunEntry, deviceId: string) =>
  entry.contexts.filter(
    (item) =>
      item.kind === "browser_tab" &&
      item.deviceId === deviceId &&
      item.metadata.remote_session === true,
  );

export const hasDesktopControl = (entry: RunEntry) =>
  entry.contexts.some((item) => item.metadata.desktop_control === true);
