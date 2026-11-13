import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { SpaceConversation } from "../api/dto/entities";
import { useAuth } from "@/features/account";
import { useSpacesStore } from "../list/useSpacesStore";
import { spaceChatConversationPath, spaceChatPath } from "./chatRoute";
import { ChatSidebar } from "./sidebar/ChatSidebar";
import { CreateEditConversationDialog } from "./sidebar/CreateEditConversationDialog";
import { NewDirectMessageDialog } from "./sidebar/NewDirectMessageDialog";
import { useSpaceChatAccess } from "./hooks/useSpaceChatAccess";
import { spacesApi } from "../api/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  useNotice,
} from "@/shared/ui";
import { useSpaceConversations } from "./sidebar/useSpaceConversations";
import { useSpaceEveryoneUnread } from "./spaceConversationsResource";
import { SpaceChat } from "./SpaceChat";
import { useEffect } from "react";
import { useRangeSelection } from "@/shared/hooks/useRangeSelection";
import { confirmAction } from "@/shared/lib/confirmAction";

/**
 * A Space's chat: a sidebar of channels and conversations with people, and the open chat
 * beside it. Agents are not in the sidebar; mention one in a message to ask it for work.
 */
export function SpaceChatEntry(props: React.ComponentProps<typeof SpaceChat>) {
  const { spaceId } = props;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const conversationId = params.get("conversation") ?? "";
  const data = useSpaceConversations(spaceId);
  const everyoneUnread = useSpaceEveryoneUnread(spaceId);
  const referenceOnly = useSpacesStore((s) => s.referenceOnly);
  const members = useSpacesStore((s) => s.membersBySpace[spaceId]);
  const loadMembers = useSpacesStore((s) => s.loadMembers);
  const nodesLoaded = useSpacesStore((s) => Boolean(s.nodesBySpace[spaceId]));
  const loadNodes = useSpacesStore((s) => s.loadNodes);
  const { isOwner } = useSpaceChatAccess(spaceId);
  const [editing, setEditing] = useState<SpaceConversation | null>();
  const [directMessageOpen, setDirectMessageOpen] = useState(false);
  const [deleting, setDeleting] = useState<SpaceConversation | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const deletableConversationIds = useMemo(
    () =>
      isOwner
        ? data.conversations
            .filter((conversation) => conversation.kind !== "dm")
            .map((conversation) => conversation.id)
        : [],
    [data.conversations, isOwner],
  );
  const selection = useRangeSelection(deletableConversationIds);
  useNotice(Boolean(deleteError), {
    message: deleteError,
    tone: "error",
    onDismiss: () => setDeleteError(""),
  });
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await spacesApi.deleteOrClearConversation(spaceId, deleting.id);
      data.remove(deleting.id);
      if (conversationId === deleting.id) navigate(spaceChatPath(spaceId));
      setDeleting(null);
    } catch {
      setDeleteError("The channel couldn't be deleted. Try again.");
    }
  };
  const deleteMany = async (ids: string[]) => {
    if (bulkDeleting || !isOwner || !ids.length) return;
    if (
      !(await confirmAction(
        `Delete ${ids.length} selected ${ids.length === 1 ? "channel" : "channels"} and their ` +
          "messages for everyone? This can't be undone.",
      ))
    )
      return;
    setBulkDeleting(true);
    setDeleteError("");
    const removed: string[] = [];
    try {
      for (const id of ids) {
        await spacesApi.deleteOrClearConversation(spaceId, id);
        data.remove(id);
        removed.push(id);
      }
      selection.clear();
      if (removed.includes(conversationId)) navigate(spaceChatPath(spaceId));
    } catch {
      setDeleteError("Some channels couldn't be deleted. Try again.");
    } finally {
      setBulkDeleting(false);
    }
  };
  useEffect(() => {
    if (!members) void loadMembers(spaceId).catch(() => {});
  }, [members, loadMembers, spaceId]);
  // Attachments name their files from the Space's nodes, which realtime only refreshes.
  useEffect(() => {
    if (!nodesLoaded) void loadNodes(spaceId).catch(() => {});
  }, [nodesLoaded, loadNodes, spaceId]);

  const select = (next: string) =>
    navigate(
      next === "everyone" ? spaceChatPath(spaceId) : spaceChatConversationPath(spaceId, next),
    );

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <ChatSidebar
        spaceName={props.spaceName}
        conversations={data.conversations}
        everyoneUnread={everyoneUnread}
        loading={data.loading}
        currentUserId={user?.id}
        selected={conversationId || "everyone"}
        canWrite={!referenceOnly}
        isOwner={isOwner}
        onSelect={select}
        onEdit={setEditing}
        onDelete={(conversation) => {
          setDeleteError("");
          setDeleting(conversation);
        }}
        onDeleteMany={(ids) => void deleteMany(ids)}
        selectedIds={selection.selectedIds}
        onRangeSelect={selection.select}
        onClearSelection={selection.clear}
        onNewConversation={() => setEditing(null)}
        onNewDirectMessage={() => setDirectMessageOpen(true)}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SpaceChat {...props} />
      </div>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete this channel?</AlertDialogTitle>
          <AlertDialogDescription>Its messages are deleted for everyone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NewDirectMessageDialog
        spaceId={spaceId}
        open={directMessageOpen}
        onOpenChange={setDirectMessageOpen}
        members={members ?? []}
        currentUserId={user?.id}
        onOpened={(opened) => {
          data.upsert(opened);
          setDirectMessageOpen(false);
          navigate(spaceChatConversationPath(spaceId, opened.id));
        }}
      />
      <CreateEditConversationDialog
        spaceId={spaceId}
        open={editing !== undefined}
        onOpenChange={(isOpen) => !isOpen && setEditing(undefined)}
        conversation={editing}
        onSaved={(saved) => {
          data.upsert(saved);
          setEditing(undefined);
          navigate(spaceChatConversationPath(spaceId, saved.id));
        }}
      />
    </div>
  );
}
