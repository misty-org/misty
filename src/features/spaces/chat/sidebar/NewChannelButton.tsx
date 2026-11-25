import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { IconButton, RowTools } from "@misty/ui";
import { useSpacesStore } from "../../list/use_spaces_store";
import type { SpaceConversation } from "../../api/dto/entities";
import { spaceCan } from "../../roles/use_space_roles";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { useSpaceConversations } from "./use_space_conversations";

export function useCanManageChannels(spaceId: string) {
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const canManage = spaceCan(space, "channels.manage") || space?.role === "owner";
  return Boolean(space) && canManage && !referenceOnly;
}

export function NewChannelButton(props: {
  spaceId: string;
  categoryId?: string | null;
  onCreated(conversation: SpaceConversation): void;
  children?: ReactNode;
}) {
  const canManage = useCanManageChannels(props.spaceId);
  const { upsert } = useSpaceConversations(props.spaceId);
  const [open, setOpen] = useState(false);
  if (!canManage) return null;
  return (
    <>
      <RowTools reveal="hover">
        <IconButton label="Create channel" onClick={() => setOpen(true)}>
          <Plus />
        </IconButton>
        {props.children}
      </RowTools>
      <CreateEditConversationDialog
        spaceId={props.spaceId}
        open={open}
        onOpenChange={setOpen}
        conversation={null}
        categoryId={props.categoryId ?? null}
        onSaved={(saved) => {
          upsert(saved);
          setOpen(false);
          props.onCreated(saved);
        }}
      />
    </>
  );
}
