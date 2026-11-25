import { ArrowDown, ArrowUp, BellOff, Settings, Trash2, UserPlus } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  ConfirmDeleteDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
  notify,
} from "@misty/ui";
import { useAuth } from "@/features/account";
import { chatMuteId, useMuted } from "@/shared/lib/message_notices";
import { spacesApi } from "../../api/api";
import type { SpaceConversation } from "../../api/dto/entities";
import { SpaceDialogs, type SpaceDialog } from "../../components/space-row/SpaceDialogs";
import { useSpacesStore } from "../../list/use_spaces_store";
import { spaceCan } from "../../roles/use_space_roles";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { conversationName } from "./conversation_groups";
import { channelLayout, moveTargets } from "./channel_layout";
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
  const { conversations, categories, upsert, remove, reload } = useSpaceConversations(
    props.spaceId,
  );
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const conversation = props.conversation;
  const canEdit = Boolean(conversation) && rights.manage;
  const text = !conversation?.voice;
  const mute = useMuted(
    props.spaceId,
    chatMuteId(props.spaceId, conversation?.id ?? ""),
    "Notifications off for this channel",
  );
  const layout = channelLayout(conversations, categories);
  const group = conversation
    ? ([layout.loose, ...layout.categories.map((item) => item.channels)].find((channels) =>
        channels.some((item) => item.id === conversation.id),
      ) ?? [])
    : [];
  const moves = conversation && canEdit ? moveTargets(group, conversation.id) : null;
  const move = (afterId: string | null) => {
    if (!conversation) return;
    void spacesApi
      .placeConversation(
        props.spaceId,
        conversation.id,
        group === layout.loose ? null : (conversation.category_id ?? null),
        afterId,
      )
      .then((saved) => {
        upsert(saved);
        return reload();
      })
      .catch(() => notify({ message: "The channel couldn't be moved. Try again.", tone: "error" }));
  };
  if (!rights.invite && !canEdit && !text) return <>{props.children}</>;
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
        <ContextMenuContent>
          {rights.invite ? (
            <MenuItem icon={UserPlus} label="Invite people" onSelect={() => setDialog("invite")} />
          ) : null}
          {text ? (
            <MenuCheckItem
              icon={BellOff}
              label="Mute channel"
              checked={mute.muted}
              disabled={mute.bySpace}
              reason="The whole Space is muted"
              closeOnSelect
              onCheckedChange={mute.toggle}
            />
          ) : null}
          {canEdit ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Settings} label="Edit channel" onSelect={() => setEditing(true)} />
              {moves?.up !== undefined ? (
                <MenuItem icon={ArrowUp} label="Move up" onSelect={() => move(moves.up!)} />
              ) : null}
              {moves?.down !== undefined ? (
                <MenuItem icon={ArrowDown} label="Move down" onSelect={() => move(moves.down!)} />
              ) : null}
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
        <SpaceDialogs
          space={rights.space}
          open={dialog}
          onOpen={setDialog}
          onClose={() => setDialog(null)}
        />
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
