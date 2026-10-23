import { agentsApi } from "@/api/agents/api";
import { assistantApi } from "@/api/assistant/api";
import { aiSurfaceApi, subscribeToAiInvocation } from "@/features/ai-surface/api";
import { apiBlobRequest } from "@/api/client";
import { configureAgentsRuntime } from "./AgentsRuntime";
export function initializeHostAgentsRuntime() {
  configureAgentsRuntime({
    agentsApi,
    assistantApi,
    aiSurfaceApi,
    subscribeToAiInvocation,
    readImage: (id) =>
      apiBlobRequest(`/misty/attachments/${encodeURIComponent(id)}/content?variant=model`),
  });
}
