import { runtimeProperty } from "@/shared/lib/runtimeProperty";
import type { spacesApi } from "@/api/spaces/api";
import type { useSpacesStore } from "@/features/spaces";
import type { useAuth } from "@/features/auth";
import type { useSetupStore } from "@/features/installer";
import type { useConnectionsStore } from "@/features/integrations";
import type { MistyPicker } from "@/features/picker";
import type { SystemErrorActivity } from "@/features/activity";
import type { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import type { useWorkspaceTabTitle } from "@/features/workspace";
import type { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import type { queueMobileChatSubmission } from "@/features/chat-composer/mobileChatQueue";
import type { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
export interface SocialRuntime {
  events: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  api: typeof spacesApi;
  useSpacesStore: typeof useSpacesStore;
  useAuth: typeof useAuth;
  useSetupStore: typeof useSetupStore;
  useConnectionsStore: typeof useConnectionsStore;
  Picker: typeof MistyPicker;
  Error: React.ComponentType<React.ComponentProps<typeof SystemErrorActivity>>;
  useAiSurfaceAdapter: typeof useAiSurfaceAdapter;
  useWorkspaceTabTitle: typeof useWorkspaceTabTitle;
  useSpaceChatDraft: typeof useSpaceChatDraft;
  queueMobileChatSubmission: typeof queueMobileChatSubmission;
  openProviderAuthorizationLink: typeof openProviderAuthorizationLink;
}
let current: SocialRuntime | undefined;
export function configureSocialRuntime(value: SocialRuntime) {
  current = value;
  return () => {
    if (current === value) current = undefined;
  };
}
export function socialRuntime() {
  if (!current) throw new Error("Social services have not been mounted.");
  return current;
}
export const socialApi = new Proxy({} as typeof spacesApi, {
  get: (target, key) => runtimeProperty(target, key, () => socialRuntime().api[key as keyof typeof spacesApi]),
});
function hook<K extends keyof SocialRuntime>(name: K): SocialRuntime[K] {
  return new Proxy((...args: unknown[]) => (socialRuntime()[name] as Function)(...args), {
    get: (target, key) => runtimeProperty(target, key, () => (socialRuntime()[name] as unknown as Record<string | symbol, unknown>)[key]),
  }) as SocialRuntime[K];
}
export const useSocialSpaces = hook("useSpacesStore"),
  useSocialAuth = hook("useAuth"),
  useSocialSetup = hook("useSetupStore"),
  useSocialConnections = hook("useConnectionsStore"),
  useSocialAi = hook("useAiSurfaceAdapter"),
  useSocialTitle = hook("useWorkspaceTabTitle"),
  useSocialDraft = hook("useSpaceChatDraft"),
  queueSocialSubmission = hook("queueMobileChatSubmission"),
  openSocialAuthorization = hook("openProviderAuthorizationLink");
export const SocialPicker = (props: React.ComponentProps<typeof MistyPicker>) => {
  const View = socialRuntime().Picker;
  return <View {...props} />;
};
export const SocialError = (props: React.ComponentProps<typeof SystemErrorActivity>) => {
  const View = socialRuntime().Error;
  return <View {...props} />;
};
export const socialErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Something went wrong.";

export const socialEvents = {
  addEventListener: (...args: Parameters<EventTarget["addEventListener"]>) =>
    socialRuntime().events.addEventListener(...args),
  removeEventListener: (...args: Parameters<EventTarget["removeEventListener"]>) =>
    socialRuntime().events.removeEventListener(...args),
};
