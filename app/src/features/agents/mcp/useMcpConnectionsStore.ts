import { create } from "zustand";
import { mcpConnectionsApi } from "./api";
import { normalizeMcpTool, publicMcpConnection } from "./normalization";
import type { McpToolWire } from "./normalization";
import type {
  McpConnection,
  McpConnectionInput,
  McpExecution,
  McpToolBinding,
  McpToolDescriptor,
} from "./types";
import { mcpToolKey } from "./types";

interface McpConnectionsState {
  scopeKey: string;
  connections: McpConnection[];
  tools: McpToolDescriptor[];
  executionsByAgent: Record<string, McpExecution[]>;
  enabledByAgent: Record<string, string[]>;
  failedToolConnectionIds: string[];
  loading: boolean;
  busy: string;
  error: string;
  load: (accountId: string, force?: boolean) => Promise<void>;
  add: (input: McpConnectionInput) => Promise<void>;
  test: (connectionId: string) => Promise<void>;
  discover: (connectionId: string) => Promise<void>;
  remove: (connectionId: string) => Promise<void>;
  loadAgentTools: (agentId: string) => Promise<void>;
  setToolEnabled: (
    agentId: string,
    connectionId: string,
    remoteName: string,
    enabled: boolean,
  ) => Promise<void>;
  reset: () => void;
}

const empty = {
  scopeKey: "",
  connections: [],
  tools: [],
  executionsByAgent: {},
  enabledByAgent: {},
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
          ? "Some connected tools could not be loaded. Tool changes are paused so existing Agent access stays unchanged."
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
      await Promise.all(
        Object.keys(get().enabledByAgent).map((agentId) => get().loadAgentTools(agentId)),
      );
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
          enabledByAgent: Object.fromEntries(
            Object.entries(state.enabledByAgent).map(([agentId, keys]) => [
              agentId,
              keys.filter((key) => !key.startsWith(`${connectionId}:`)),
            ]),
          ),
          error: failedToolConnectionIds.length ? state.error : "",
          busy: "",
        };
      });
    } catch (error) {
      if (get().scopeKey !== scopeKey) return;
      set({ busy: "", error: errorMessage(error, "That connection could not be removed.") });
    }
  },

  loadAgentTools: async (agentId) => {
    const scopeKey = get().scopeKey;
    const [toolResult, executionResult] = await Promise.allSettled([
      mcpConnectionsApi.agentTools(agentId),
      mcpConnectionsApi.executions(agentId),
    ]);
    if (get().scopeKey !== scopeKey) return;
    if (toolResult.status === "rejected") {
      set({ error: errorMessage(toolResult.reason, "This Agent's tools could not be loaded.") });
      return;
    }
    set((state) => ({
      tools: mergeBindingTools(state.tools, toolResult.value.tools),
      enabledByAgent: {
        ...state.enabledByAgent,
        [agentId]: toolResult.value.tools
          .filter((tool) => tool.enabled)
          .map((tool) => mcpToolKey(tool.connection_id, tool.remote_name)),
      },
      executionsByAgent: {
        ...state.executionsByAgent,
        [agentId]: executionResult.status === "fulfilled" ? executionResult.value.executions : [],
      },
    }));
  },

  setToolEnabled: async (agentId, connectionId, remoteName, enabled) => {
    if (get().failedToolConnectionIds.length) {
      set({
        error:
          "Tool changes are paused until every connection loads, so existing Agent access cannot be changed accidentally.",
      });
      return;
    }
    const scopeKey = get().scopeKey;
    const changedKey = mcpToolKey(connectionId, remoteName);
    const current = new Set(get().enabledByAgent[agentId] ?? []);
    if (enabled) current.add(changedKey);
    else current.delete(changedKey);
    const input = get().tools.map((tool) => ({
      connection_id: tool.connection_id,
      remote_name: tool.remote_name,
      enabled: current.has(mcpToolKey(tool.connection_id, tool.remote_name)),
    }));
    set({ busy: `tool:${agentId}:${changedKey}`, error: "" });
    try {
      const result = await mcpConnectionsApi.setAgentTools(agentId, input);
      if (get().scopeKey !== scopeKey) return;
      set((state) => ({
        tools: mergeBindingTools(state.tools, result.tools),
        enabledByAgent: {
          ...state.enabledByAgent,
          [agentId]: result.tools
            .filter((tool) => tool.enabled)
            .map((tool) => mcpToolKey(tool.connection_id, tool.remote_name)),
        },
        busy: "",
      }));
    } catch (error) {
      if (get().scopeKey !== scopeKey) return;
      set({ busy: "", error: errorMessage(error, "That tool setting could not be saved.") });
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

function mergeBindingTools(current: McpToolDescriptor[], bindings: McpToolBinding[]) {
  const byKey = new Map(
    current.map((tool) => [mcpToolKey(tool.connection_id, tool.remote_name), tool]),
  );
  for (const binding of normalizeTools(bindings)) {
    byKey.set(mcpToolKey(binding.connection_id, binding.remote_name), binding);
  }
  return Array.from(byKey.values());
}

function replace<T extends { id: string }>(items: T[], next: T): T[] {
  return items.some((item) => item.id === next.id)
    ? items.map((item) => (item.id === next.id ? next : item))
    : [...items, next];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
