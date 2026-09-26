import { spacesApi } from "@/api/spaces/api";
import { SystemErrorActivity } from "@/features/activity";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useAuth } from "@/features/auth";
import { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import { useSetupStore } from "@/features/installer";
import { useConnectionsStore } from "@/features/integrations";
import { MistyPicker } from "@/features/picker";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceTabTitle } from "@/features/workspace";
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
    openProviderAuthorizationLink,
  });
}
