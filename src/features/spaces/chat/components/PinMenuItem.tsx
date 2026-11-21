import { useEffect } from "react";
import { Pin, PinOff } from "lucide-react";
import { MenuItem } from "@misty/ui";
import type { SpaceMessage } from "../../api/dto/entities";
import { useCanPin, useIsPinned, usePinnedStore } from "./pinnedStore";

/**
 * "Pin message" or "Unpin message" in a message's ⋯ and right-click menu, shown only where the
 * person may pin. The chat's pins are read the first time a menu asks.
 */
export function PinMenuItem(props: {
  spaceId: string;
  message: SpaceMessage;
  canManageMessages: boolean;
}) {
  const { spaceId, message } = props;
  const conversationId = message.conversation_id ?? "";
  const canPin = useCanPin(spaceId, props.canManageMessages);
  const pinned = useIsPinned(spaceId, conversationId, message.id);
  useEffect(() => {
    if (canPin) usePinnedStore.getState().ensure(spaceId, conversationId);
  }, [canPin, spaceId, conversationId]);
  if (!canPin || message.local_delivery_state || message.thread_root_id) return null;
  return (
    <MenuItem
      icon={pinned ? PinOff : Pin}
      label={pinned ? "Unpin message" : "Pin message"}
      onSelect={() =>
        void usePinnedStore.getState().setPinned(spaceId, conversationId, message, !pinned)
      }
    />
  );
}
