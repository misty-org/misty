import type {
  AiInvocationDeviceContext,
  AiInvocationRequest,
} from "../runs/invocations/invocation_types";
import { invoke } from "@/native/invoke";

const scope = "device:agent-run-contexts";
const contextLifetimeMs = 6 * 3_600_000;
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
  permissionMode: string;
  collaborationMode: string;
  account: string;
  voice?: boolean;
  parentRunId?: string;
  notebookKey?: string;
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

type RunOwnership = Pick<RunEntry, "account" | "voice" | "parentRunId" | "notebookKey">;

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
      permissionMode: request.permissionMode || "ask",
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

export interface RunContextOfChat {
  account: string;
  conversationId: string;
  voice?: boolean;
  parentRunId?: string;
  notebookKey?: string;
}

const known = new Map<string, RunContextOfChat>();

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

const lookupAttempts = 30;
const lookupPauseMs = 100;

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

export async function loadRunEntry(runId: string): Promise<RunEntry | null> {
  const read = async () => (await snapshot().catch(() => null))?.state?.runs?.[runId] ?? null;
  const entry = await read();
  if (entry) return entry;
  await new Promise((done) => setTimeout(done, 1_000));
  return read();
}

export async function runSpaceId(runId: string): Promise<string | null> {
  if (!runId) return null;
  const entry = (await snapshot().catch(() => null))?.state?.runs?.[runId];
  return entry ? (entry.spaceId ?? "") : null;
}

export * from "./run_context_scopes";
