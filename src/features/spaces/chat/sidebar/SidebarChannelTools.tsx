import { Settings, Trash2, UserPlus } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  ConfirmDeleteDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  MenuItem,
  MenuSeparator,
  notify,
} from "@misty/ui";
import { useAuth } from "@/features/account";
import { spacesApi } from "../../api/api";
import type { SpaceConversation } from "../../api/dto/entities";
import { SpaceDialogs, type SpaceDialog } from "../../components/space-row/SpaceDialogs";
import { useSpacesStore } from "../../list/use_spaces_store";
import { spaceCan } from "../../roles/use_space_roles";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { conversationName } from "./conversation_groups";
import { useSpaceConversations } from "./use_space_conversations";

function useChannelRights(spaceId: string) {
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const owner = space?.role === "owner";
  return {
    space,
    manage: !referenceOnly && (owner || spaceCan(space, "channels.manage")),
    invite: !referenceOnly && Boolean(space) && spaceCan(space, "space.invite"),
    write: !referenceOnly,
  };
}

export function ChannelRowMenu(props: {
  spaceId: string;
  conversation?: SpaceConversation;
  onDeleted?(): void;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const rights = useChannelRights(props.spaceId);
  const { upsert, remove } = useSpaceConversations(props.spaceId);
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const conversation = props.conversation;
  const canEdit = Boolean(conversation) && rights.manage;
  if (!rights.invite && !canEdit) return <>{props.children}</>;
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
        <ContextMenuContent>
          {rights.invite ? (
            <MenuItem icon={UserPlus} label="Invite people" onSelect={() => setDialog("invite")} />
          ) : null}
          {canEdit ? (
            <>
              <MenuItem icon={Settings} label="Edit channel" onSelect={() => setEditing(true)} />
              <MenuSeparator />
              <MenuItem
                icon={Trash2}
                label="Delete channel"
                danger
                onSelect={() => setDeleting(true)}
              />
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
      {rights.space ? (
        <SpaceDialogs space={rights.space} open={dialog} onClose={() => setDialog(null)} />
      ) : null}
      {conversation && canEdit ? (
        <>
          <CreateEditConversationDialog
            spaceId={props.spaceId}
            open={editing}
            onOpenChange={setEditing}
            conversation={conversation}
            onSaved={(saved) => {
              upsert(saved);
              setEditing(false);
            }}
          />
          <ConfirmDeleteDialog
            open={deleting}
            onOpenChange={setDeleting}
            title="Delete this channel?"
            what={`#${conversationName(conversation, user?.id)} and its messages, for everyone.`}
            onConfirm={async () => {
              try {
                await spacesApi.deleteOrClearConversation(props.spaceId, conversation.id);
                remove(conversation.id);
                props.onDeleted?.();
              } catch {
                notify({ message: "The channel couldn't be deleted. Try again.", tone: "error" });
              }
            }}
          />
        </>
      ) : null}
    </>
  );
}
