import { spacesApi } from "@/api/spaces/api";
import { SystemErrorActivity } from "@/features/activity";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useAuth } from "@/features/auth";
import { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import { useNativeSessionStore } from "@/features/native-session";
import { useConnectionsStore } from "@/features/integrations";
import { MistyPicker } from "@/features/picker";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceViewTitle } from "@/features/workspace";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import { configureSocialRuntime } from "./SocialRuntime";
export function initializeHostSocialRuntime() {
  configureSocialRuntime({
    events: window,
    api: spacesApi,
    useSpacesStore,
    useAuth,
    useNativeSessionStore,
    useConnectionsStore,
    Picker: MistyPicker,
    Error: SystemErrorActivity,
    useAiSurfaceAdapter,
    useWorkspaceViewTitle: useWorkspaceViewTitle,
    useSpaceChatDraft,
    openProviderAuthorizationLink,
  });
}
