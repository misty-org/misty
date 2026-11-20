import { Plus, Settings, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  ConfirmDeleteDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  IconButton,
  MenuItem,
  MenuSeparator,
  RowTools,
  notify,
} from "@misty/ui";
import { useAuth } from "@/features/account";
import { spacesApi } from "../../api/api";
import type { SpaceConversation } from "../../api/dto/entities";
import { SpaceDialogs, type SpaceDialog } from "../../components/space-row/SpaceDialogs";
import { useSpacesStore } from "../../list/useSpacesStore";
import { spaceCan } from "../../roles/useSpaceRoles";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { NewDirectMessageDialog } from "./NewDirectMessageDialog";
import { conversationName } from "./conversationGroups";
import { useSpaceConversations } from "./useSpaceConversations";

/** What the person may do with the Space's channels here. */
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

/**
 * A channel row in the window's sidebar with its right-click menu: Invite people, then, for
 * someone who manages channels, Edit channel and Delete channel (which asks first). `everyone`
 * (no `conversation`) offers only the invite. The row itself is the child.
 */
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

/**
 * The + at the end of the sidebar's Direct messages heading (a `group/row`), shown while the
 * heading is hovered: it picks someone in the Space and opens the direct message with them.
 */
export function NewDirectMessageButton(props: {
  spaceId: string;
  onOpened(conversation: SpaceConversation): void;
}) {
  const { user } = useAuth();
  const rights = useChannelRights(props.spaceId);
  const members = useSpacesStore((state) => state.membersBySpace[props.spaceId]);
  const loadMembers = useSpacesStore((state) => state.loadMembers);
  const { upsert } = useSpaceConversations(props.spaceId);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !members) void loadMembers(props.spaceId).catch(() => {});
  }, [open, members, loadMembers, props.spaceId]);
  if (!rights.write) return null;
  return (
    <>
      <RowTools reveal="hover">
        <IconButton label="New direct message" onClick={() => setOpen(true)}>
          <Plus />
        </IconButton>
      </RowTools>
      <NewDirectMessageDialog
        spaceId={props.spaceId}
        open={open}
        onOpenChange={setOpen}
        members={members ?? []}
        currentUserId={user?.id}
        onOpened={(opened) => {
          upsert(opened);
          setOpen(false);
          props.onOpened(opened);
        }}
      />
    </>
  );
}
