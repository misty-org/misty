import {
  figmaDrawingsApi,
  type FigmaBinding,
  type FigmaBindingContext,
  type FigmaContentRecord,
  type FigmaFileSummary,
  type FigmaProject,
} from "@/api/integrations/figma";
import { connectionsApi, type AccountConnection } from "@/api/connections";
import { create } from "zustand";

interface FigmaDrawingsState {
  scopeKey: string;
  accounts: AccountConnection[];
  bindings: FigmaBinding[];
  recordsByBinding: Record<string, FigmaContentRecord[]>;
  contextByBinding: Record<string, FigmaBindingContext>;
  liveSyncByBinding: Record<string, number>;
  projects: FigmaProject[];
  files: FigmaFileSummary[];
  loading: boolean;
  busy: string;
  error: string;
  load: (accountId: string, spaceId: string) => Promise<void>;
  discoverProjects: (connectionId: string, teamId: string) => Promise<void>;
  discoverFiles: (connectionId: string, projectId: string) => Promise<void>;
  bindFile: (spaceId: string, connectionId: string, fileKey: string) => Promise<void>;
  bindProject: (
    spaceId: string,
    connectionId: string,
    teamId: string,
    projectId: string,
  ) => Promise<void>;
  sync: (spaceId: string, bindingId: string) => Promise<void>;
  reconcileWebhooks: (spaceId: string, bindingId: string) => Promise<void>;
  context: (
    spaceId: string,
    bindingId: string,
    fileKey?: string,
  ) => Promise<FigmaBindingContext | undefined>;
  comment: (
    spaceId: string,
    bindingId: string,
    fileKey: string,
    message: string,
    nodeId?: string,
    idempotencyKey?: string,
  ) => Promise<void>;
  unbind: (spaceId: string, bindingId: string) => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

const empty = {
  scopeKey: "",
  accounts: [],
  bindings: [],
  recordsByBinding: {},
  contextByBinding: {},
  liveSyncByBinding: {},
  projects: [],
  files: [],
  loading: false,
  busy: "",
  error: "",
};

export const useFigmaDrawingsStore = create<FigmaDrawingsState>((set, get) => ({
  ...empty,

  load: async (accountId, spaceId) => {
    const scopeKey = `${accountId}:${spaceId}`;
    set({ ...empty, scopeKey, loading: true });
    try {
      const [connectionResult, bindingResult] = await Promise.all([
        connectionsApi.list(),
        figmaDrawingsApi.bindings(spaceId),
      ]);
      if (get().scopeKey !== scopeKey) return;
      set({
        accounts: connectionResult.connections.filter((item) => item.provider === "figma"),
        bindings: bindingResult.bindings,
        loading: false,
      });
      const records = await Promise.allSettled(
        bindingResult.bindings.map(async (binding) => ({
          id: binding.id,
          records: (await figmaDrawingsApi.records(spaceId, binding.id)).records,
        })),
      );
      if (get().scopeKey !== scopeKey) return;
      set({
        recordsByBinding: Object.fromEntries(
          records.flatMap((result) =>
            result.status === "fulfilled" ? [[result.value.id, result.value.records] as const] : [],
          ),
        ),
      });
    } catch (error) {
      if (get().scopeKey !== scopeKey) return;
      set({ loading: false, error: message(error, "Figma could not be loaded.") });
    }
  },

  discoverProjects: async (connectionId, teamId) => {
    set({ busy: "projects", error: "", projects: [], files: [] });
    try {
      const result = await figmaDrawingsApi.projects(connectionId, teamId);
      set({ projects: result.projects, busy: "" });
    } catch (error) {
      set({
        busy: "",
        error: message(error, "Project browsing is unavailable for this Figma app."),
      });
    }
  },

  discoverFiles: async (connectionId, projectId) => {
    set({ busy: "files", error: "", files: [] });
    try {
      const result = await figmaDrawingsApi.projectFiles(connectionId, projectId);
      set({ files: result.files, busy: "" });
    } catch (error) {
      set({ busy: "", error: message(error, "Figma project files could not be listed.") });
    }
  },

  bindFile: async (spaceId, connectionId, fileKey) => {
    set({ busy: "bind", error: "" });
    try {
      const result = await figmaDrawingsApi.bind(spaceId, {
        connection_id: connectionId,
        resource_type: "file",
        file_key: fileKey,
      });
      set((state) => ({ bindings: replace(state.bindings, result.binding), busy: "" }));
      const recordResult = await figmaDrawingsApi
        .records(spaceId, result.binding.id)
        .catch(() => null);
      if (recordResult) {
        set((state) => ({
          recordsByBinding: {
            ...state.recordsByBinding,
            [result.binding.id]: recordResult.records,
          },
        }));
      }
    } catch (error) {
      set({ busy: "", error: message(error, "That Figma file could not be linked.") });
      throw error;
    }
  },

  bindProject: async (spaceId, connectionId, teamId, projectId) => {
    set({ busy: "bind", error: "" });
    try {
      const result = await figmaDrawingsApi.bind(spaceId, {
        connection_id: connectionId,
        resource_type: "project",
        team_id: teamId,
        project_id: projectId,
      });
      set((state) => ({ bindings: replace(state.bindings, result.binding), busy: "" }));
      const recordResult = await figmaDrawingsApi
        .records(spaceId, result.binding.id)
        .catch(() => null);
      if (recordResult) {
        set((state) => ({
          recordsByBinding: {
            ...state.recordsByBinding,
            [result.binding.id]: recordResult.records,
          },
        }));
      }
    } catch (error) {
      set({ busy: "", error: message(error, "That Figma project could not be linked.") });
      throw error;
    }
  },

  sync: async (spaceId, bindingId) => {
    set({ busy: `sync:${bindingId}`, error: "" });
    try {
      const syncResult = await figmaDrawingsApi.sync(spaceId, bindingId);
      const recordResult = await figmaDrawingsApi.records(spaceId, bindingId);
      set((state) => ({
        bindings: replace(state.bindings, syncResult.binding),
        recordsByBinding: { ...state.recordsByBinding, [bindingId]: recordResult.records },
        busy: "",
      }));
    } catch (error) {
      set({ busy: "", error: message(error, "Figma context could not be refreshed.") });
    }
  },

  reconcileWebhooks: async (spaceId, bindingId) => {
    set({ busy: `webhooks:${bindingId}`, error: "" });
    try {
      const result = await figmaDrawingsApi.reconcileWebhooks(spaceId, bindingId);
      set((state) => ({
        bindings: replace(state.bindings, result.binding),
        liveSyncByBinding: {
          ...state.liveSyncByBinding,
          [bindingId]: result.subscriptions.length,
        },
        busy: "",
      }));
    } catch (error) {
      set({ busy: "", error: message(error, "Figma live sync could not be enabled.") });
    }
  },

  context: async (spaceId, bindingId, fileKey = "") => {
    set({ busy: `context:${bindingId}`, error: "" });
    try {
      const result = await figmaDrawingsApi.context(spaceId, bindingId, fileKey);
      set((state) => ({
        contextByBinding: { ...state.contextByBinding, [contextKey(bindingId, fileKey)]: result },
        busy: "",
      }));
      return result;
    } catch (error) {
      set({ busy: "", error: message(error, "That Figma file context is unavailable.") });
      return undefined;
    }
  },

  comment: async (spaceId, bindingId, fileKey, comment, nodeId = "", idempotencyKey = "") => {
    set({ busy: `comment:${bindingId}`, error: "" });
    try {
      await figmaDrawingsApi.comment(spaceId, bindingId, {
        file_key: fileKey || undefined,
        message: comment,
        node_id: nodeId || undefined,
        confirmed: true,
        idempotency_key: idempotencyKey || crypto.randomUUID(),
      });
      await get().context(spaceId, bindingId, fileKey);
    } catch (error) {
      set({ busy: "", error: message(error, "The Figma comment could not be posted.") });
      throw error;
    }
  },

  unbind: async (spaceId, bindingId) => {
    set({ busy: `unbind:${bindingId}`, error: "" });
    try {
      await figmaDrawingsApi.unbind(spaceId, bindingId);
      set((state) => ({
        bindings: state.bindings.filter((item) => item.id !== bindingId),
        busy: "",
      }));
    } catch (error) {
      set({ busy: "", error: message(error, "The Figma source could not be removed.") });
    }
  },

  disconnect: async (connectionId) => {
    set({ busy: `disconnect:${connectionId}`, error: "" });
    try {
      await connectionsApi.remove(connectionId);
      set((state) => ({
        accounts: state.accounts.filter((item) => item.id !== connectionId),
        bindings: state.bindings.filter((item) => item.connection_id !== connectionId),
        busy: "",
      }));
    } catch (error) {
      set({ busy: "", error: message(error, "Figma could not be disconnected.") });
    }
  },

  clearError: () => set({ error: "" }),
  reset: () => set(empty),
}));

export function contextKey(bindingId: string, fileKey = ""): string {
  return `${bindingId}:${fileKey}`;
}

function replace<T extends { id: string }>(items: T[], next: T): T[] {
  return items.some((item) => item.id === next.id)
    ? items.map((item) => (item.id === next.id ? next : item))
    : [...items, next];
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
