import { agentsApi } from "@/api/agents/api";
import { assistantApi } from "@/api/assistant/api";
import { aiSurfaceApi, subscribeToAiInvocation } from "@/features/ai-surface/api";
import { automationsApi } from "./automations/api";
import { mcpConnectionsApi } from "./mcp/api";
import { useAuth, useAccountAvatarUrl } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceStore } from "@/features/workspace";
import { SystemErrorActivity } from "@/features/activity";
import {
  executeGlobalSearch,
  executeGlobalVisualSearch,
} from "@/features/global-search/globalSearchExecution";
import { createAgentOwnedBrowserWorkspace } from "./agentOwnedBrowserWorkspace";
import { uploadMistyImage, deleteMistyImage } from "@/features/global-search/mistyImageAttachments";
import { apiBlobRequest } from "@/api/client";
import { configureAgentsRuntime } from "./agentsRuntime";
export function initializeHostAgentsRuntime() {
  configureAgentsRuntime({
    agentsApi,
    assistantApi,
    aiSurfaceApi,
    automationsApi,
    mcpConnectionsApi,
    subscribeToAiInvocation,
    useAuth,
    useAccountAvatarUrl,
    useSpacesStore,
    useWorkspaceStore,
    Error: SystemErrorActivity,
    executeGlobalSearch,
    executeGlobalVisualSearch,
    createAgentOwnedBrowserWorkspace,
    uploadMistyImage,
    deleteMistyImage,
    readImage: (id) =>
      apiBlobRequest(`/misty/attachments/${encodeURIComponent(id)}/content?variant=model`),
  });
}
