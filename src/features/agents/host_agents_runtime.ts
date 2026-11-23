import { aiSurfaceApi, subscribeToAiInvocation } from "./runs/invocations/api";
import { localAttachmentImage } from "./conversations/composer/local_attachments";
import { configureAgentsRuntime } from "./agents_runtime";
export function initializeHostAgentsRuntime() {
  configureAgentsRuntime({
    aiSurfaceApi,
    subscribeToAiInvocation,
    readImage: localAttachmentImage,
  });
}
