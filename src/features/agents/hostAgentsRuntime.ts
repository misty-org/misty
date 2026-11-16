import { aiSurfaceApi, subscribeToAiInvocation } from "./runs/invocations/api";
import { localAttachmentImage } from "./conversations/composer/localAttachments";
import { configureAgentsRuntime } from "./AgentsRuntime";
export function initializeHostAgentsRuntime() {
  configureAgentsRuntime({
    aiSurfaceApi,
    subscribeToAiInvocation,
    readImage: localAttachmentImage,
  });
}
