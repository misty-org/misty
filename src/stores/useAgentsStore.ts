import { create } from "zustand";
import { errorText } from "../shared/format";
import { hasTauriInternals } from "../shared/tauri";
import {
  agentsCancelJob,
  agentsDeleteDefinition,
  agentsRegisterFolderScope,
  agentsResolveApproval,
  agentsSaveDefinition,
  agentsSnapshot,
  cancelServerAgentJob,
  deleteServerAgentDefinition,
  fetchServerAgentSnapshot,
  resolveServerAgentApproval,
  retryServerAgentJob,
  saveServerAgentDefinition,
} from "../agents/api";
import type {
  AgentApproval,
  AgentDefinition,
  AgentDraft,
  AgentJob,
  AgentScope,
  AgentSnapshot,
} from "../agents/types";
import { emptyAgentSnapshot } from "../agents/types";

interface AgentsStore {
  snapshot: AgentSnapshot;
  loading: boolean;
  saving: boolean;
  error: string | null;
  syncNotice: string | null;
  draft: AgentDraft | null;
  selectedAgentId: string | null;
  load: (personalSpaceId?: string) => Promise<void>;
  beginFolderDraft: (path: string, displayName: string, spaceId: string) => void;
  clearDraft: () => void;
  selectAgent: (agentId: string | null) => void;
  registerFolderScope: (path: string, displayName: string) => Promise<AgentScope>;
  saveDefinition: (definition: AgentDefinition) => Promise<AgentDefinition>;
  deleteDefinition: (agentId: string) => Promise<void>;
  resolveApproval: (approvalId: string, decision: "approved" | "denied") => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
}

export const useAgentsStore = create<AgentsStore>((set, get) => ({
  snapshot: emptyAgentSnapshot(),
  loading: false,
  saving: false,
  error: null,
  syncNotice: null,
  draft: null,
  selectedAgentId: null,

  load: async (personalSpaceId) => {
    if (get().loading) return;
    set({ loading: true, error: null, syncNotice: null });
    const [nativeResult, serverResult] = await Promise.allSettled([
      hasTauriInternals() ? agentsSnapshot() : Promise.reject(new Error("Native agent runtime is unavailable.")),
      fetchServerAgentSnapshot(),
    ]);
    const rawNativeSnapshot = nativeResult.status === "fulfilled" ? nativeResult.value : null;
    const nativeSnapshot = rawNativeSnapshot && personalSpaceId
      ? assignLegacyDefinitionsToSpace(rawNativeSnapshot, personalSpaceId)
      : rawNativeSnapshot;
    const serverSnapshot = serverResult.status === "fulfilled" ? serverResult.value : null;
    if (!nativeSnapshot && !serverSnapshot) {
      set({
        loading: false,
        error: errorText(serverResult.status === "rejected" ? serverResult.reason : nativeResult.status === "rejected" ? nativeResult.reason : "Agents could not be loaded."),
      });
      return;
    }
    const snapshot = mergeAgentSnapshots(nativeSnapshot, serverSnapshot);
    set((state) => ({
      snapshot,
      loading: false,
      selectedAgentId: state.selectedAgentId && snapshot.definitions.some((item) => item.id === state.selectedAgentId)
        ? state.selectedAgentId
        : snapshot.definitions[0]?.id ?? null,
      syncNotice: nativeSnapshot && serverSnapshot
        ? null
        : nativeSnapshot
          ? "Showing device data. Cloud sync is temporarily unavailable."
          : "Showing cloud data. This device runtime is unavailable.",
    }));
    if (rawNativeSnapshot && nativeSnapshot && hasTauriInternals()) {
      const migrated = nativeSnapshot.definitions.filter((definition, index) => !rawNativeSnapshot.definitions[index]?.spaceId && Boolean(definition.spaceId));
      if (migrated.length > 0) void Promise.allSettled(migrated.map((definition) => agentsSaveDefinition({ definition })));
    }
  },

  beginFolderDraft: (path, displayName, spaceId) => set({ draft: { localPath: path, displayName, spaceId } }),
  clearDraft: () => set({ draft: null }),
  selectAgent: (selectedAgentId) => set({ selectedAgentId }),

  registerFolderScope: async (path, displayName) => {
    if (hasTauriInternals()) return agentsRegisterFolderScope({ path });
    return {
      id: makeId("scope"),
      deviceId: get().snapshot.device?.id ?? "browser-preview",
      displayName,
      kind: "local_folder",
      relativePath: null,
      available: true,
    };
  },

  saveDefinition: async (definition) => {
    set({ saving: true, error: null, syncNotice: null });
    let saved = definition;
    let nativeError: unknown = null;
    let serverError: unknown = null;
    if (hasTauriInternals()) {
      try {
        saved = await agentsSaveDefinition({ definition });
      } catch (error) {
        nativeError = error;
      }
    }
    try {
      saved = await saveServerAgentDefinition(saved);
    } catch (error) {
      serverError = error;
    }
    if (hasTauriInternals() && !serverError) {
      try {
        saved = await agentsSaveDefinition({ definition: saved });
      } catch (error) {
        nativeError = error;
      }
    }
    if ((hasTauriInternals() && nativeError) && serverError) {
      const message = `Agent could not be saved: ${errorText(serverError)}`;
      set({ saving: false, error: message });
      throw new Error(message);
    }
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        definitions: upsertById(state.snapshot.definitions, saved),
        scopes: upsertById(state.snapshot.scopes, saved.scope),
        loadedAt: new Date().toISOString(),
      },
      saving: false,
      selectedAgentId: saved.id,
      draft: null,
      syncNotice: serverError
        ? "Saved on this device. Cloud sync will retry when the server is available."
        : nativeError
          ? "Saved to Misty Cloud. This device could not update its local copy."
          : null,
    }));
    return saved;
  },

  deleteDefinition: async (agentId) => {
    set({ saving: true, error: null, syncNotice: null });
    const results = await Promise.allSettled([
      hasTauriInternals() ? agentsDeleteDefinition({ agentId }) : Promise.resolve(),
      deleteServerAgentDefinition(agentId),
    ]);
    if (results.every((result) => result.status === "rejected")) {
      const message = `Agent could not be deleted: ${errorText(results[1].status === "rejected" ? results[1].reason : results[0])}`;
      set({ saving: false, error: message });
      throw new Error(message);
    }
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        definitions: state.snapshot.definitions.filter((item) => item.id !== agentId),
      },
      saving: false,
      selectedAgentId: state.selectedAgentId === agentId ? null : state.selectedAgentId,
      syncNotice: results.some((result) => result.status === "rejected") ? "Deleted from one source; the other will reconcile later." : null,
    }));
  },

  resolveApproval: async (approvalId, decision) => {
    const approval = get().snapshot.approvals.find((item) => item.id === approvalId);
    if (!approval) return;
    set({ saving: true, error: null });
    const results = await Promise.allSettled([
      hasTauriInternals()
        ? agentsResolveApproval({ approvalId, decision, actionDigest: approval.action.digest })
        : Promise.reject(new Error("Native agent runtime is unavailable.")),
      resolveServerAgentApproval(approvalId, decision, approval.action.digest),
    ]);
    const resolved = fulfilledValue(results[1]) ?? fulfilledValue(results[0]);
    if (!resolved) {
      const message = `Approval could not be resolved: ${errorText(results[1].status === "rejected" ? results[1].reason : results[0])}`;
      set({ saving: false, error: message });
      throw new Error(message);
    }
    set((state) => ({
      snapshot: { ...state.snapshot, approvals: upsertById(state.snapshot.approvals, resolved) },
      saving: false,
      syncNotice: results.some((result) => result.status === "rejected") ? "Approval was recorded and will reconcile when all services are available." : null,
    }));
  },

  cancelJob: async (jobId) => {
    set({ saving: true, error: null });
    const results = await Promise.allSettled([
      hasTauriInternals() ? agentsCancelJob({ jobId }) : Promise.reject(new Error("Native agent runtime is unavailable.")),
      cancelServerAgentJob(jobId),
    ]);
    const job = fulfilledValue(results[1]) ?? fulfilledValue(results[0]);
    if (!job) {
      const message = `Run could not be canceled: ${errorText(results[1].status === "rejected" ? results[1].reason : results[0])}`;
      set({ saving: false, error: message });
      throw new Error(message);
    }
    set((state) => ({
      snapshot: { ...state.snapshot, jobs: upsertById(state.snapshot.jobs, job) },
      saving: false,
    }));
  },

  retryJob: async (jobId) => {
    set({ saving: true, error: null });
    try {
      const job = await retryServerAgentJob(jobId);
      set((state) => ({
        snapshot: { ...state.snapshot, jobs: upsertById(state.snapshot.jobs, job) },
        saving: false,
      }));
    } catch (error) {
      const message = `Run could not be retried: ${errorText(error)}`;
      set({ saving: false, error: message });
      throw new Error(message);
    }
  },
}));

export function resetAgentsAccountState(): void {
  useAgentsStore.setState({
    snapshot: emptyAgentSnapshot(),
    loading: false,
    saving: false,
    error: null,
    syncNotice: null,
    draft: null,
    selectedAgentId: null,
  });
}

function mergeAgentSnapshots(local: AgentSnapshot | null, server: AgentSnapshot | null): AgentSnapshot {
  if (!local) return server ?? emptyAgentSnapshot();
  if (!server) return local;
  const scopes = mergeById(local.scopes, server.scopes).map((scope) => {
    const localScope = local.scopes.find((item) => item.id === scope.id);
    return localScope ? { ...scope, ...localScope } : scope;
  });
  const definitions = mergeAgentDefinitions(local.definitions, server.definitions, scopes);
  return {
    version: 1,
    localWebhookUrl: local.localWebhookUrl ?? server.localWebhookUrl ?? null,
    device: local.device ?? server.device,
    scopes,
    definitions,
    jobs: mergeById(local.jobs, server.jobs),
    approvals: mergeById(local.approvals, server.approvals),
    artifacts: mergeById(local.artifacts, server.artifacts),
    loadedAt: new Date().toISOString(),
  };
}

function assignLegacyDefinitionsToSpace(snapshot: AgentSnapshot, personalSpaceId: string): AgentSnapshot {
  return {
    ...snapshot,
    definitions: snapshot.definitions.map((definition) => ({
      ...definition,
      spaceId: definition.spaceId?.trim() || personalSpaceId,
    })),
  };
}

function mergeAgentDefinitions(local: AgentDefinition[], server: AgentDefinition[], scopes: AgentScope[]): AgentDefinition[] {
  const localById = new Map(local.map((definition) => [definition.id, definition]));
  const values = new Map(local.map((definition) => [definition.id, definition]));
  for (const remote of server) {
    const localDefinition = localById.get(remote.id);
    values.set(remote.id, {
      ...localDefinition,
      ...remote,
      deviceId: localDefinition?.deviceId ?? remote.deviceId,
      scope: scopes.find((scope) => scope.id === remote.scope.id) ?? localDefinition?.scope ?? remote.scope,
    });
  }
  return [...values.values()];
}

function mergeById<T extends { id: string }>(local: T[], server: T[]): T[] {
  const values = new Map(server.map((item) => [item.id, item]));
  local.forEach((item) => values.set(item.id, { ...values.get(item.id), ...item }));
  return [...values.values()];
}

function upsertById<T extends { id: string }>(values: T[], next: T): T[] {
  const index = values.findIndex((item) => item.id === next.id);
  if (index < 0) return [next, ...values];
  return values.map((item, itemIndex) => itemIndex === index ? next : item);
}

function fulfilledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

function makeId(prefix: string): string {
  return `${prefix}_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

export const agentJobsForDefinition = (snapshot: AgentSnapshot, agentId: string): AgentJob[] =>
  snapshot.jobs
    .filter((job) => job.agentId === agentId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

export const agentApprovalsForDefinition = (snapshot: AgentSnapshot, agentId: string): AgentApproval[] =>
  snapshot.approvals
    .filter((approval) => approval.agentId === agentId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
