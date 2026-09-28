import { spacesApi } from "@/api/spaces/api";
import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";
import { useAuth } from "@/features/auth";
import { confirmAction } from "@/shared/lib/confirmAction";
import {
  ContextMenu,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuTrigger,
  IconButton,
  NavigationTreeItem,
} from "@/shared/ui";
import { Hash, Pencil, Plus, Trash2, User, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  socialConversationPath,
  socialProviderFromRoute,
  socialProviderPath,
} from "../../social/socialRoute";
import { useSpacesStore } from "../../store/useSpacesStore";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { conversationName, groupConversations, ProviderIcon } from "./conversationGroups";
import { useSpaceConversations } from "./useSpaceConversations";

/** Every conversation in a Space: channels, direct messages, then connected accounts. */
export function SpaceChatSidebar(props: { spaceId: string; onNavigate: (path: string) => void }) {
  const { spaceId, onNavigate } = props;
  const { user } = useAuth();
  const location = useLocation();
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const members = useSpacesStore((state) => state.membersBySpace[spaceId]);
  const loadMembers = useSpacesStore((state) => state.loadMembers);
  const readable = space?.permissions?.["messages.read"] !== false;
  const { conversations, loading, upsert, remove } = useSpaceConversations(spaceId, readable);
  const [editing, setEditing] = useState<SpaceConversation | null | undefined>(undefined);
  useEffect(() => {
    if (editing !== undefined && !members) void loadMembers(spaceId).catch(() => {});
  }, [editing, loadMembers, members, spaceId]);
  const provider = socialProviderFromRoute(location.pathname);
  const activeId = new URLSearchParams(location.search).get("conversation") ?? "";
  const onChat = location.pathname.split("/")[3] === "social";
  const owner = space?.role === "owner";
  const deleteConversation = async (conversation: SpaceConversation) => {
    const name = conversationName(conversation, user?.id);
    if (!(await confirmAction(`Delete “${name}” for everyone?`, "Delete conversation"))) return;
    await spacesApi.deleteOrClearConversation(spaceId, conversation.id).catch(() => {});
    remove(conversation.id);
    if (conversation.id === activeId) onNavigate(socialProviderPath(spaceId, "misty"));
  };
  const row = (to: string, icon: ReactNode, label: string, selected: boolean) => (
    <NavigationTreeItem asChild icon={icon} label={label} selected={selected} nested={false}>
      <Link
        to={to}
        title={label}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          onNavigate(to);
        }}
      />
    </NavigationTreeItem>
  );
  if (!readable)
    return <p className="px-2.5 py-2 text-xs text-cream-muted">You can’t read chats here.</p>;
  return (
    <div className="misty-scrollbar -mr-1 min-h-0 flex-1 overflow-y-auto pr-1" aria-label="Chats">
      {groupConversations(conversations).map((group) => {
        if (!group.everyone && !group.conversations.length) return null;
        return (
          <section key={group.id} className="mb-3 grid gap-1" aria-label={group.title}>
            <header className="flex h-6 items-center justify-between pl-2.5 text-[11px] font-medium text-cream-muted">
              {group.title}
              {group.everyone ? (
                <IconButton label="New conversation" size="2xs" onClick={() => setEditing(null)}>
                  <Plus />
                </IconButton>
              ) : null}
            </header>
            {group.everyone
              ? row(
                  socialProviderPath(spaceId, "misty"),
                  <Users aria-hidden="true" />,
                  "Everyone",
                  onChat && provider === "misty" && !activeId,
                )
              : null}
            {group.conversations.map((conversation) => {
              const name = conversationName(conversation, user?.id);
              const mine = conversation.created_by_user_id === user?.id;
              const canEdit = mine && conversation.kind !== "direct" && group.provider === "misty";
              const canDelete = owner || mine;
              const icon =
                group.provider !== "misty" ? (
                  <ProviderIcon provider={group.provider} />
                ) : conversation.kind === "direct" ? (
                  <User aria-hidden="true" />
                ) : (
                  <Hash aria-hidden="true" />
                );
              const link = row(
                socialConversationPath(spaceId, group.provider, conversation.id),
                icon,
                name,
                conversation.id === activeId,
              );
              if (!canEdit && !canDelete) return <div key={conversation.id}>{link}</div>;
              return (
                <ContextMenu key={conversation.id}>
                  <ContextMenuTrigger asChild>{link}</ContextMenuTrigger>
                  <ContextMenuContent className="w-44">
                    {canEdit ? (
                      <ContextMenuAction
                        icon={<Pencil />}
                        label="Edit conversation"
                        onSelect={() => setEditing(conversation)}
                      />
                    ) : null}
                    {canDelete ? (
                      <ContextMenuAction
                        icon={<Trash2 />}
                        label="Delete conversation"
                        destructive
                        onSelect={() => void deleteConversation(conversation)}
                      />
                    ) : null}
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </section>
        );
      })}
      {loading && !conversations.length ? (
        <p className="px-2.5 text-[11px] text-cream-muted">Loading chats…</p>
      ) : null}
      <CreateEditConversationDialog
        spaceId={spaceId}
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        members={members ?? []}
        currentUserId={user?.id}
        conversation={editing}
        onSaved={(saved) => {
          upsert(saved);
          if (editing === null) onNavigate(socialConversationPath(spaceId, "misty", saved.id));
        }}
      />
    </div>
  );
}
