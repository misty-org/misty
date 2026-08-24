import { create } from "zustand";
import { mcpConnectionsApi } from "./api";
import { normalizeMcpTool, publicMcpConnection } from "./normalization";
import type { McpToolWire } from "./normalization";
import type { McpConnection, McpConnectionInput, McpToolDescriptor } from "./types";

interface McpConnectionsState {
  scopeKey: string;
  connections: McpConnection[];
  tools: McpToolDescriptor[];
  failedToolConnectionIds: string[];
  loading: boolean;
  busy: string;
  error: string;
  load: (accountId: string, force?: boolean) => Promise<void>;
  add: (input: McpConnectionInput) => Promise<void>;
  test: (connectionId: string) => Promise<void>;
  discover: (connectionId: string) => Promise<void>;
  remove: (connectionId: string) => Promise<void>;
  reset: () => void;
}

const empty = {
  scopeKey: "",
  connections: [],
  tools: [],
  failedToolConnectionIds: [],
  loading: false,
  busy: "",
  error: "",
};

export const useMcpConnectionsStore = create<McpConnectionsState>((set, get) => ({
  ...empty,
  load: async (accountId, force = false) => {
    if (get().scopeKey === accountId && get().loading) return;
    if (!force && get().scopeKey === accountId && !get().loading && get().connections.length)
      return;
    set({ ...empty, scopeKey: accountId, loading: true });
    try {
      const result = await mcpConnectionsApi.list();
      if (get().scopeKey !== accountId) return;
      set({ connections: result.connections.map(publicMcpConnection), loading: false });
      const toolResults = await Promise.allSettled(
        result.connections.map(async (connection) => ({
          connectionId: connection.id,
          tools: (await mcpConnectionsApi.tools(connection.id)).tools,
        })),
      );
      if (get().scopeKey !== accountId) return;
      const failedToolConnectionIds = toolResults
        .map((toolResult, index) =>
          toolResult.status === "rejected" ? result.connections[index]?.id : undefined,
        )
        .filter((id): id is string => Boolean(id));
      set({
        tools: normalizeTools(
          toolResults.flatMap((result) =>
            result.status === "fulfilled" ? result.value.tools : [],
          ),
        ),
        failedToolConnectionIds,
        error: failedToolConnectionIds.length
          ? "Some connected tools could not be loaded. Reconnect or rediscover those servers before Misty uses them."
          : "",
      });
    } catch (error) {
      if (get().scopeKey !== accountId) return;
      set({ loading: false, error: errorMessage(error, "Tool connections could not be loaded.") });
    }
  },

  add: async (input) => {
    const scopeKey = get().scopeKey;
    set({ busy: "add", error: "" });
    try {
      const result = await mcpConnectionsApi.add(input);
      if (get().scopeKey !== scopeKey) return;
      set((state) => ({
        connections: replace(state.connections, publicMcpConnection(result.connection)),
        busy: "",
      }));
      await get().discover(result.connection.id);
    } catch (error) {
      if (get().scopeKey !== scopeKey) return;
      set({ busy: "", error: errorMessage(error, "That tool server could not be connected.") });
      throw error;
    }
  },

  test: async (connectionId) => {
    const scopeKey = get().scopeKey;
    set({ busy: `test:${connectionId}`, error: "" });
    try {
      const result = await mcpConnectionsApi.test(connectionId);
      if (get().scopeKey !== scopeKey) return;
      set((state) => ({
        connections: replace(state.connections, publicMcpConnection(result.connection)),
        busy: "",
      }));
    } catch (error) {
      if (get().scopeKey !== scopeKey) return;
      set({ busy: "", error: errorMessage(error, "Misty could not reach that tool server.") });
    }
  },

  discover: async (connectionId) => {
    const scopeKey = get().scopeKey;
    set({ busy: `discover:${connectionId}`, error: "" });
    try {
      const result = await mcpConnectionsApi.discover(connectionId);
      if (get().scopeKey !== scopeKey) return;
      set((state) => {
        const failedToolConnectionIds = state.failedToolConnectionIds.filter(
          (id) => id !== connectionId,
        );
        return {
          connections: replace(state.connections, publicMcpConnection(result.connection)),
          tools: [
            ...state.tools.filter((item) => item.connection_id !== connectionId),
            ...normalizeTools(result.tools),
          ],
          failedToolConnectionIds,
          error: failedToolConnectionIds.length ? state.error : "",
          busy: "",
        };
      });
    } catch (error) {
      if (get().scopeKey !== scopeKey) return;
      set({ busy: "", error: errorMessage(error, "Misty could not find tools on that server.") });
    }
  },

  remove: async (connectionId) => {
    const scopeKey = get().scopeKey;
    set({ busy: `remove:${connectionId}`, error: "" });
    try {
      await mcpConnectionsApi.remove(connectionId);
      if (get().scopeKey !== scopeKey) return;
      set((state) => {
        const failedToolConnectionIds = state.failedToolConnectionIds.filter(
          (id) => id !== connectionId,
        );
        return {
          connections: state.connections.filter((item) => item.id !== connectionId),
          tools: state.tools.filter((item) => item.connection_id !== connectionId),
          failedToolConnectionIds,
          error: failedToolConnectionIds.length ? state.error : "",
          busy: "",
        };
      });
    } catch (error) {
      if (get().scopeKey !== scopeKey) return;
      set({ busy: "", error: errorMessage(error, "That connection could not be removed.") });
    }
  },

  reset: () => set(empty),
}));

export function resetMcpConnectionsAccountState(): void {
  useMcpConnectionsStore.getState().reset();
}

function normalizeTools(tools: McpToolWire[]): McpToolDescriptor[] {
  return tools.flatMap((tool) => {
    const normalized = normalizeMcpTool(tool);
    return normalized ? [normalized] : [];
  });
}

function replace<T extends { id: string }>(items: T[], next: T): T[] {
  return items.some((item) => item.id === next.id)
    ? items.map((item) => (item.id === next.id ? next : item))
    : [...items, next];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
