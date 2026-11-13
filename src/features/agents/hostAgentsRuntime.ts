import { agentsApi } from "./api/api";
import { aiSurfaceApi, subscribeToAiInvocation } from "./runs/invocations/api";
import { localAttachmentImage } from "./conversations/composer/localAttachments";
import { configureAgentsRuntime } from "./AgentsRuntime";
export function initializeHostAgentsRuntime() {
  configureAgentsRuntime({
    agentsApi,
    aiSurfaceApi,
    subscribeToAiInvocation,
    readImage: localAttachmentImage,
  });
}
