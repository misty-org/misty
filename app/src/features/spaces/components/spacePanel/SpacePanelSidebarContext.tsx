import type { SocialProviderId } from "@/api/social";
import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";
import type { AccountConnection } from "@/api/connections";
import { SpaceChatConversationList } from "../SpaceChatConversationList";

export interface SpacePanelSidebarContextProps {
  section: string;
  activeSpaceId: string;
  socialProvider: SocialProviderId;
  conversations: SpaceConversation[];
  activeConversationId: string | null;
  currentUserId: string | undefined;
  onCreateConversation?: () => void;
  onEditConversation?: (conversation: SpaceConversation) => void;
  onDeleteConversation?: (conversation: SpaceConversation) => void;
  isSpaceOwner?: boolean;
  isMistySpace?: boolean;
  socialAccounts?: AccountConnection[];
  socialAccountsLoading?: boolean;
  socialAuthorizingProvider?: string | null;
  onConnectSocialAccount?: (provider: Exclude<SocialProviderId, "misty">) => void;
}

export function spacePanelSidebarAvailable(section: string): boolean {
  return section === "social";
}

/**
 * The contextual half of the Space panel, below the Space switcher.
 *
 * Stable destinations live in the global navigator. This panel is reserved
 * for the live objects inside the selected destination.
 */
export function SpacePanelSidebarContext(props: SpacePanelSidebarContextProps) {
  if (!spacePanelSidebarAvailable(props.section)) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SpaceChatConversationList
        activeSpaceId={props.activeSpaceId}
        conversations={props.conversations}
        activeConversationId={props.activeConversationId}
        provider={props.socialProvider}
        currentUserId={props.currentUserId}
        onCreateConversation={props.onCreateConversation}
        onEditConversation={props.onEditConversation}
        onDeleteConversation={props.onDeleteConversation}
        isSpaceOwner={props.isSpaceOwner}
        isMistySpace={props.isMistySpace}
        accounts={props.socialAccounts}
        accountsLoading={props.socialAccountsLoading}
        authorizingProvider={props.socialAuthorizingProvider}
        onConnectAccount={props.onConnectSocialAccount}
      />
    </div>
  );
}
