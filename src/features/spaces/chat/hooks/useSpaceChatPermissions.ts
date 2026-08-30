import { useSpacesStore } from "@/features/spaces";
import type { Space } from "@/api/spaces/dto/interfaces/types";

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
  _conversationId = "",
  _conversationKind?: "standard" | "direct" | "misty_support",
): SpaceChatPermissions {
  const activeSpace = useSpacesStore((state) => state.spaces.find((space) => space.id === spaceId));
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const permissions = activeSpace?.permissions;
  const canWriteMessages = !referenceOnly && permissions?.["messages.write"] !== false;

  return {
    activeSpace,
    permissions,
    canReadMessages: permissions?.["messages.read"] !== false,
    canWriteMessages,
    canUploadAttachments: canWriteMessages && permissions?.["attachments.upload"] !== false,
    canBrowseLibrary: canWriteMessages && permissions?.["library.view"] !== false,
    canCopyLibrary: permissions?.["library.download"] !== false,
    canAddToLibrary: permissions?.["library.add"] !== false,
    isOwner: activeSpace?.role === "owner",
  };
}
