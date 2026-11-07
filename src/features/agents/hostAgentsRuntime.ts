import { agentsApi } from "@/api/agents/api";
import { aiSurfaceApi, subscribeToAiInvocation } from "@/features/ai-surface/api";
import { localAttachmentImage } from "@/features/misty/localAttachments";
import { configureAgentsRuntime } from "./AgentsRuntime";
export function initializeHostAgentsRuntime() {
  configureAgentsRuntime({
    agentsApi,
    aiSurfaceApi,
    subscribeToAiInvocation,
    readImage: localAttachmentImage,
  });
}
