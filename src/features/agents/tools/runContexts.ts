import type {
  AiInvocationDeviceContext,
  AiInvocationRequest,
} from "../runs/invocations/invocationTypes";
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

export async function change(update: (runs: Record<string, RunEntry>) => void) {
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

export function asContext(context: AiInvocationDeviceContext, now: number): RunDeviceContext {
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

/**
 * The one Space a run works in: its chat's, saved before the run started. Empty for a run that
 * names none, which then reaches every Space the person can.
 */
export async function runSpaceId(runId: string): Promise<string> {
  if (!runId) return "";
  const entry = (await snapshot().catch(() => null))?.state?.runs?.[runId];
  return entry?.spaceId ?? "";
}

export * from "./runContextScopes";
