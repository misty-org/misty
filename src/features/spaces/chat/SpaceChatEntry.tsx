import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { SpaceConversation } from "@/api/spaces/dto/entities";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "../store/useSpacesStore";
import { spaceChatConversationPath, spaceChatPath } from "./chatRoute";
import { ChatSidebar } from "./sidebar/ChatSidebar";
import { CreateEditConversationDialog } from "./sidebar/CreateEditConversationDialog";
import { useSpaceChatAccess } from "./hooks/useSpaceChatAccess";
import { spacesApi } from "@/api/spaces/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/shared/ui";
import { useSpaceConversations } from "./sidebar/useSpaceConversations";
import { SpaceSocial } from "./SpaceChat";
import { useEffect } from "react";

/**
 * A Space's chat: a sidebar of channels and conversations with people, and the open chat
 * beside it. Agents are not in the sidebar; mention one in a message to ask it for work.
 */
export function SpaceChatEntry(props: React.ComponentProps<typeof SpaceSocial>) {
  const { spaceId } = props;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const conversationId = params.get("conversation") ?? "";
  const data = useSpaceConversations(spaceId);
  const referenceOnly = useSpacesStore((s) => s.referenceOnly);
  const members = useSpacesStore((s) => s.membersBySpace[spaceId]);
  const loadMembers = useSpacesStore((s) => s.loadMembers);
  const { isOwner } = useSpaceChatAccess(spaceId);
  const [editing, setEditing] = useState<SpaceConversation | null>();
  const [deleting, setDeleting] = useState<SpaceConversation | null>(null);
  const [deleteError, setDeleteError] = useState("");
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
  useEffect(() => {
    if (!members) void loadMembers(spaceId).catch(() => {});
  }, [members, loadMembers, spaceId]);

  const select = (next: string) =>
    navigate(
      next === "everyone" ? spaceChatPath(spaceId) : spaceChatConversationPath(spaceId, next),
    );

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <ChatSidebar
        spaceName={props.spaceName}
        conversations={data.conversations}
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
        onNewConversation={() => setEditing(null)}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SpaceSocial {...props} />
      </div>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete this channel?</AlertDialogTitle>
          <AlertDialogDescription>
            The channel and its messages are deleted for everyone in it. This can&apos;t be undone.
          </AlertDialogDescription>
          {deleteError ? <p role="alert">{deleteError}</p> : null}
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
      <CreateEditConversationDialog
        spaceId={spaceId}
        open={editing !== undefined}
        onOpenChange={(isOpen) => !isOpen && setEditing(undefined)}
        members={members ?? []}
        currentUserId={user?.id}
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
