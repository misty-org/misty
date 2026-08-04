import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { isMistySpace } from "../mistySpace";

export interface SpaceChatPermissions {
  activeSpace: Space | undefined;
  permissions: Space["permissions"] | undefined;
  canReadMessages: boolean;
  canWriteMessages: boolean;
  canUploadAttachments: boolean;
  canBrowseLibrary: boolean;
  canCopyLibrary: boolean;
  canAddToLibrary: boolean;
  isOwner: boolean;
}

/**
 * What the current member may do in this Space's chat.
 *
 * Permissions are absent until the snapshot lands, so every flag defaults to
 * allowed and only an explicit `false` from the backend takes it away.
 */
export function useSpaceChatPermissions(
  spaceId: string,
  conversationId = "",
  conversationKind?: "standard" | "misty_support",
): SpaceChatPermissions {
  const activeSpace = useSpacesStore((state) => state.spaces.find((space) => space.id === spaceId));
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const permissions = activeSpace?.permissions;
  const mistySpace = isMistySpace(activeSpace);
  const inMistySupportConversation =
    mistySpace &&
    Boolean(conversationId) &&
    (conversationKind === "misty_support" ||
      conversationId === activeSpace?.support_conversation_id);
  const canWriteMessages =
    !referenceOnly &&
    (mistySpace
      ? inMistySupportConversation && permissions?.["misty.support.write"] !== false
      : permissions?.["messages.write"] !== false);

  return {
    activeSpace,
    permissions,
    canReadMessages: permissions?.["messages.read"] !== false,
    canWriteMessages,
    canUploadAttachments:
      !mistySpace && canWriteMessages && permissions?.["attachments.upload"] !== false,
    canBrowseLibrary: !mistySpace && canWriteMessages && permissions?.["library.view"] !== false,
    canCopyLibrary: permissions?.["library.download"] !== false,
    canAddToLibrary: !mistySpace && permissions?.["library.add"] !== false,
    isOwner: activeSpace?.role === "owner",
  };
}
