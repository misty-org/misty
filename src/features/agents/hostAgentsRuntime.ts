import { openMisty } from "@/features/misty/handoff";
import { agentsApi } from "@/api/agents/api";
import { assistantApi } from "@/api/assistant/api";
import { aiSurfaceApi, subscribeToAiInvocation } from "@/features/ai-surface/api";
import { useAuth, useAccountAvatarUrl } from "@/features/auth";
import { useWorkspaceStore } from "@/features/workspace";
import { SystemErrorNotice } from "@/features/support/systemErrors";
import {
  executeGlobalSearch,
  executeGlobalVisualSearch,
} from "@/features/global-search/globalSearchExecution";
import { createAgentOwnedBrowserWorkspace } from "./agentOwnedBrowserWorkspace";
import { uploadMistyImage, deleteMistyImage } from "@/features/global-search/mistyImageAttachments";
import { apiBlobRequest } from "@/api/client";
import { configureAgentsRuntime } from "./AgentsRuntime";
export function initializeHostAgentsRuntime() {
  configureAgentsRuntime({
    openMisty,
    agentsApi,
    assistantApi,
    aiSurfaceApi,
    subscribeToAiInvocation,
    useAuth,
    useAccountAvatarUrl,
    useWorkspaceStore,
    Error: SystemErrorNotice,
    executeGlobalSearch,
    executeGlobalVisualSearch,
    createAgentOwnedBrowserWorkspace,
    uploadMistyImage,
    deleteMistyImage,
    readImage: (id) =>
      apiBlobRequest(`/misty/attachments/${encodeURIComponent(id)}/content?variant=model`),
  });
}
