import { openMisty } from "@/features/misty/handoff";
import { useActivityStore } from "@/features/activity/useActivityStore";
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
    openMisty,
    reportActivity(event, accountId) {
      const activity = useActivityStore.getState();
      if (activity.accountId !== accountId) return;
      activity.ingestLocal({ id: `agent-run:${event.operationId}`, accountId, appId: "agents", sourceLabel: "Agents",
        status: event.status, revision: event.revision,
        kind: event.status === "completed" ? "completion" : event.status === "blocked" ? "failure" : "system",
        lifecycle: event.status === "blocked" ? "request" : "update",
        title: event.title, body: event.body,
        target: { kind: "route", href: `/apps/agents?run=${encodeURIComponent(event.operationId)}` },
      });
    },
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
