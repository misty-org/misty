import type { agentsApi } from "@/api/agents/api";
import type { assistantApi } from "@/api/assistant/api";
import type { aiSurfaceApi, subscribeToAiInvocation } from "@/features/ai-surface/api";
import type { automationsApi } from "./automations/api";
import type { mcpConnectionsApi } from "./mcp/api";
import type { useAuth, useAccountAvatarUrl } from "@/features/auth";
import type { useSpacesStore } from "@/features/spaces";
import type { useWorkspaceStore } from "@/features/workspace";
import type { SystemErrorActivity } from "@/features/activity";
import type {
  executeGlobalSearch,
  executeGlobalVisualSearch,
} from "@/features/global-search/globalSearchExecution";
import type { createAgentOwnedBrowserWorkspace } from "./agentOwnedBrowserWorkspace";
import type {
  uploadMistyImage,
  deleteMistyImage,
} from "@/features/global-search/mistyImageAttachments";
export interface AgentsRuntime {
  agentsApi: typeof agentsApi;
  assistantApi: typeof assistantApi;
  aiSurfaceApi: typeof aiSurfaceApi;
  automationsApi: typeof automationsApi;
  mcpConnectionsApi: typeof mcpConnectionsApi;
  subscribeToAiInvocation: typeof subscribeToAiInvocation;
  useAuth: typeof useAuth;
  useAccountAvatarUrl: typeof useAccountAvatarUrl;
  useSpacesStore: typeof useSpacesStore;
  useWorkspaceStore: typeof useWorkspaceStore;
  Error: React.ComponentType<React.ComponentProps<typeof SystemErrorActivity>>;
  executeGlobalSearch: typeof executeGlobalSearch;
  executeGlobalVisualSearch: typeof executeGlobalVisualSearch;
  createAgentOwnedBrowserWorkspace: typeof createAgentOwnedBrowserWorkspace;
  uploadMistyImage: typeof uploadMistyImage;
  deleteMistyImage: typeof deleteMistyImage;
  readImage(id: string): Promise<Blob>;
}
let current: AgentsRuntime | undefined;
export function configureAgentsRuntime(value: AgentsRuntime) {
  current = value;
  return () => {
    if (current === value) current = undefined;
  };
}
export function agentsRuntime() {
  if (!current) throw new Error("Agents services have not been mounted.");
  return current;
}
function service<K extends keyof AgentsRuntime>(name: K): AgentsRuntime[K] {
  return new Proxy((...args: unknown[]) => (agentsRuntime()[name] as Function)(...args), {
    get:
      (_, key) =>
      (...args: unknown[]) =>
        (agentsRuntime()[name] as unknown as Record<string | symbol, Function>)[key](...args),
  }) as AgentsRuntime[K];
}
export const runtimeAgentsApi = service("agentsApi"),
  runtimeAssistantApi = service("assistantApi"),
  runtimeAiApi = service("aiSurfaceApi"),
  runtimeAutomationsApi = service("automationsApi"),
  runtimeMcpApi = service("mcpConnectionsApi"),
  subscribeAgentsInvocation = service("subscribeToAiInvocation"),
  useAgentsAuth = service("useAuth"),
  useAgentsAvatar = service("useAccountAvatarUrl"),
  useAgentsSpaces = service("useSpacesStore"),
  useAgentsWorkspace = service("useWorkspaceStore"),
  searchAgents = service("executeGlobalSearch"),
  visualSearchAgents = service("executeGlobalVisualSearch"),
  createAgentsBrowser = service("createAgentOwnedBrowserWorkspace"),
  uploadAgentsImage = service("uploadMistyImage"),
  deleteAgentsImage = service("deleteMistyImage"),
  readAgentsImage = service("readImage");
export const AgentsError = (props: React.ComponentProps<typeof SystemErrorActivity>) => {
  const View = agentsRuntime().Error;
  return <View {...props} />;
};
