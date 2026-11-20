import { Plus } from "lucide-react";
import { useState } from "react";
import { IconButton, RowTools } from "@misty/ui";
import { useSpacesStore } from "../../list/useSpacesStore";
import type { SpaceConversation } from "../../api/dto/entities";
import { spaceCan } from "../../roles/useSpaceRoles";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { useSpaceConversations } from "./useSpaceConversations";

/**
 * The + at the end of the sidebar's Channels heading, shown while the heading (a `group/row`) is
 * hovered, as Discord keeps it beside its channel list. It opens the New channel dialog and, once
 * the channel is made, opens it. Only someone who may manage the Space's channels sees it.
 */
export function NewChannelButton(props: {
  spaceId: string;
  onCreated(conversation: SpaceConversation): void;
}) {
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === props.spaceId));
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const { upsert } = useSpaceConversations(props.spaceId);
  const [open, setOpen] = useState(false);
  const canManage = spaceCan(space, "channels.manage") || space?.role === "owner";
  if (!space || !canManage || referenceOnly) return null;
  return (
    <>
      <RowTools reveal="hover">
        <IconButton label="New channel" onClick={() => setOpen(true)}>
          <Plus />
        </IconButton>
      </RowTools>
      <CreateEditConversationDialog
        spaceId={props.spaceId}
        open={open}
        onOpenChange={setOpen}
        conversation={null}
        onSaved={(saved) => {
          upsert(saved);
          setOpen(false);
          props.onCreated(saved);
        }}
      />
    </>
  );
}
