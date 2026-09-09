import { spacesApi } from "@/api/spaces/api";
import { useSpacesStore } from "@/features/spaces";
import { useAuth } from "@/features/auth";
import { useSetupStore } from "@/features/installer";
import { useConnectionsStore } from "@/features/integrations";
import { MistyPicker } from "@/features/picker";
import { SystemErrorActivity } from "@/features/activity";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useWorkspaceTabTitle } from "@/features/workspace";
import { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import { queueMobileChatSubmission } from "@/features/chat-composer/mobileChatQueue";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import { configureSocialRuntime } from "./socialRuntime";
export function initializeHostSocialRuntime() {
  configureSocialRuntime({
    events: window,
    api: spacesApi,
    useSpacesStore,
    useAuth,
    useSetupStore,
    useConnectionsStore,
    Picker: MistyPicker,
    Error: SystemErrorActivity,
    useAiSurfaceAdapter,
    useWorkspaceTabTitle,
    useSpaceChatDraft,
    queueMobileChatSubmission,
    openProviderAuthorizationLink,
  });
}
