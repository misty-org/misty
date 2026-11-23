import { Plus } from "lucide-react";
import { useState } from "react";
import { IconButton, RowTools } from "@misty/ui";
import { useSpacesStore } from "../../list/use_spaces_store";
import type { SpaceConversation } from "../../api/dto/entities";
import { spaceCan } from "../../roles/use_space_roles";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { useSpaceConversations } from "./use_space_conversations";

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
