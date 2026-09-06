import { spacesApi } from "@/api/spaces/api";
import { SystemErrorNotice } from "@/features/support/systemErrors";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useAuth } from "@/features/auth";
import { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import { useNativeSessionStore } from "@/features/native-session";
import { MistyPicker } from "@/features/picker";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceViewTitle } from "@/features/workspace";
import { configureSocialRuntime } from "./SocialRuntime";
export function initializeHostSocialRuntime() {
  configureSocialRuntime({
    events: window,
    api: spacesApi,
    useSpacesStore,
    useAuth,
    useNativeSessionStore,
    Picker: MistyPicker,
    Error: SystemErrorNotice,
    useAiSurfaceAdapter,
    useWorkspaceViewTitle: useWorkspaceViewTitle,
    useSpaceChatDraft,
  });
}
