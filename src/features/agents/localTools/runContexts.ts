import type { AiInvocationDeviceContext, AiInvocationRequest } from "@/features/ai-surface/types";
import { invoke } from "@/native/invoke";

/**
 * What each run may reach on this computer: the screens, folders and browser it was sent with, the
 * tabs that joined it since, and its modes. The window that starts a run may not be the window that
 * runs its tools, and a run can resume after a restart (`resume_unfinished` in the agent runtime), so
 * this lives in this device's `settings_state` rows in `misty.db`, not in a window's memory. A run
 * with no entry has nothing to act with: its tools refuse, and nothing here guesses.
 */

const scope = "device:agent-run-contexts";
/** As long as the run grants this computer signs (`device_sign_run_grants`). */
const contextLifetimeMs = 6 * 3_600_000;
/** A finished run needs no entry by then. */
const entryLifetimeMs = 24 * 3_600_000;

export interface RunDeviceContext {
  id: string;
  deviceId: string;
  kind: AiInvocationDeviceContext["kind"];
  opaqueRef: string;
  displayName: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
  runGrant?: { payload: string; signature: string };
  expiresAt: string;
}

export interface RunEntry {
  runId: string;
  agentId: string;
  taskId: string;
  windowLabel: string;
  conversationId: string;
  spaceId: string;
  executionMode: string;
  /** The run's frozen Ask or Auto. Anything unknown is Ask. */
  permissionMode: "ask" | "auto";
  collaborationMode: string;
  /** Whose misty.db rows the run reads and writes. */
  account: string;
  /** A spoken turn: a goal doesn't continue from one. */
  voice?: boolean;
  /** Set for a sub-agent: it shows in its parent, and writes to the parent's notebook. */
  parentRunId?: string;
  notebookKey?: string;
  /** The person's screen came with the request, so a look has nothing to add. */
  captureAttached: boolean;
  attachments: Array<{ id: string; name: string }>;
  contexts: RunDeviceContext[];
  updatedAt: number;
}

interface Stored {
  version: 1;
  runs: Record<string, RunEntry>;
}

interface Snapshot {
  revision: number;
  state: Partial<Stored> | null;
}

const snapshot = () => invoke<Snapshot>("settings_session_state", { scope });

async function change(update: (runs: Record<string, RunEntry>) => void) {
  for (let attempt = 0; ; attempt++) {
    const { revision, state } = await snapshot();
    const runs = { ...state?.runs };
    const oldest = Date.now() - entryLifetimeMs;
    for (const [id, entry] of Object.entries(runs)) {
      if (entry.updatedAt < oldest) delete runs[id];
    }
    update(runs);
    try {
      await invoke("settings_session_commit", {
        scope,
        revision,
        document: { version: 1, runs } satisfies Stored,
      });
      return;
    } catch (error) {
      if (attempt >= 8 || !String(error).includes("SETTINGS_REVISION_CONFLICT")) throw error;
    }
  }
}

function asContext(context: AiInvocationDeviceContext, now: number): RunDeviceContext {
  return {
    id: crypto.randomUUID(),
    deviceId: context.deviceId,
    kind: context.kind,
    opaqueRef: context.opaqueRef,
    displayName: context.displayName ?? "",
    capabilities: context.capabilities,
    metadata: { ...context.metadata },
    runGrant: context.runGrant,
    expiresAt: new Date(now + contextLifetimeMs).toISOString(),
  };
}

export type RunOwnership = Pick<RunEntry, "account" | "voice" | "parentRunId" | "notebookKey">;

/** Records a run as it starts, under the grants this computer signed for it. */
export async function rememberRun(
  runId: string,
  conversationId: string | undefined,
  request: AiInvocationRequest,
  signed: AiInvocationDeviceContext[] | undefined,
  ownership: RunOwnership = { account: "" },
) {
  const now = Date.now();
  await change((runs) => {
    const earlier = runs[runId];
    const contexts = (signed ?? []).map((context) => asContext(context, now));
    // The same request sent again names the same run: tabs that joined it stay.
    for (const joined of earlier?.contexts ?? []) {
      if (!contexts.some((item) => item.opaqueRef === joined.opaqueRef)) contexts.push(joined);
    }
    runs[runId] = {
      runId,
      agentId: request.agentId ?? "",
      taskId: request.taskId ?? "",
      windowLabel: request.windowLabel ?? "",
      conversationId: conversationId ?? request.conversationId ?? "",
      spaceId: request.spaceId ?? "",
      executionMode: request.executionMode ?? "",
      permissionMode: request.permissionMode === "auto" ? "auto" : "ask",
      collaborationMode: request.collaborationMode ?? "",
      captureAttached: Boolean(request.capture || request.displayCaptures?.length),
      attachments: (request.attachmentIds ?? []).map((id) => ({
        id,
        name: request.attachmentNames?.[id] ?? "attachment",
      })),
      contexts,
      updatedAt: now,
      ...ownership,
    };
  });
  known.delete(runId);
}

/** Which chat a run belongs to, which is what a run's own state needs of its entry. */
export interface RunContextOfChat {
  account: string;
  /** Empty for a run outside any chat. */
  conversationId: string;
  voice?: boolean;
  parentRunId?: string;
  notebookKey?: string;
}

const known = new Map<string, RunContextOfChat>();

/** Notes a run with nothing to reach, for what only needs to find its chat. */
export async function noteRunOwner(runId: string, context: RunContextOfChat) {
  const now = Date.now();
  await change((runs) => {
    const blank: RunEntry = {
      runId,
      agentId: "",
      taskId: "",
      windowLabel: "",
      conversationId: "",
      spaceId: "",
      executionMode: "",
      permissionMode: "ask",
      collaborationMode: "",
      account: context.account,
      captureAttached: false,
      attachments: [],
      contexts: [],
      updatedAt: now,
    };
    runs[runId] = { ...blank, ...runs[runId], ...context };
  });
  known.set(runId, context);
}

/** A run can reach its first tool as its start is still being saved. */
const lookupAttempts = 30;
const lookupPauseMs = 100;

/** The chat a run belongs to, or null for a run nobody noted. A run that has ended needs only one look. */
export async function runContext(
  runId: string,
  attempts = lookupAttempts,
): Promise<RunContextOfChat | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await new Promise((done) => setTimeout(done, lookupPauseMs));
    const remembered = known.get(runId);
    if (remembered) return remembered;
    const entry = (await snapshot().catch(() => null))?.state?.runs?.[runId];
    if (entry?.account) {
      const context: RunContextOfChat = {
        account: entry.account,
        conversationId: entry.conversationId,
        voice: entry.voice,
        parentRunId: entry.parentRunId,
        notebookKey: entry.notebookKey,
      };
      known.set(runId, context);
      return context;
    }
  }
  return null;
}

export function forgetKnownRunsForTests() {
  known.clear();
}

/** The run's entry, or null. A run's first call can reach here just before its start is saved. */
export async function loadRunEntry(runId: string): Promise<RunEntry | null> {
  const read = async () => (await snapshot().catch(() => null))?.state?.runs?.[runId] ?? null;
  const entry = await read();
  if (entry) return entry;
  await new Promise((done) => setTimeout(done, 1_000));
  return read();
}

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
      item.kind === "browser_tab" && item.deviceId === deviceId && item.metadata.remote_session === true,
  );

export const hasDesktopControl = (entry: RunEntry) =>
  entry.contexts.some((item) => item.metadata.desktop_control === true);
