import { useMemo, useState } from "react";
import { Bot, LogOut, MessagesSquare, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { SpaceConversation } from "../api/dto/entities";
import { useAuth } from "@/features/account";
import { useSpacesStore } from "../list/useSpacesStore";
import { spaceChatConversationPath, spaceChatPath } from "./chatRoute";
import { FluxerSidebar } from "./fluxer/FluxerSidebar";
import { FluxerChatRoot } from "./fluxer/FluxerChatRoot";
import { cx } from "./fluxer/cx";
import guildLayout from "./fluxer/css/GuildLayout.module.css";
import shell from "./fluxer/css/SpaceChatShell.module.css";
import { CreateEditConversationDialog } from "./sidebar/CreateEditConversationDialog";
import { NewDirectMessageDialog } from "./sidebar/NewDirectMessageDialog";
import { AddPeopleDialog, ConversationAgentsDialog } from "./sidebar/GroupDirectDialogs";
import { isGroupDirectMessage } from "./sidebar/conversationGroups";
import { useOwnMentionableAgents } from "./ownAgents";
import { useSpaceChatAccess } from "./hooks/useSpaceChatAccess";
import { spacesApi } from "../api/api";
import { SpaceCrumb } from "../components/space-row/SpaceCrumb";
import { SpaceDialogs, type SpaceDialog } from "../components/space-row/SpaceDialogs";
import { RolesDialog } from "../roles/RolesDialog";
import { useChatSidebarPreferences } from "./sidebar/chatSidebarPreferences";
import { useChatSidePanel } from "./chatSidePanelStore";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  PageHeader,
  SearchField,
  Surface,
  useNotice,
  type ActionBarItem,
} from "@misty/ui";
import { useSpaceConversations } from "./sidebar/useSpaceConversations";
import { reloadSpaceConversations, useSpaceEveryoneUnread } from "./spaceConversationsResource";
import { SpaceChat } from "./SpaceChat";
import { spaceCan } from "../roles/useSpaceRoles";
import { useEffect } from "react";
import { useRangeSelection } from "@/shared/hooks/useRangeSelection";
import { confirmAction } from "@/shared/lib/confirmAction";

/**
 * A Space's chat, one of its pages: the bar every Space page wears (the Space, then Chat, with the
 * member list's toggle and message search), then Discord's layout under it: the channel column
 * (the Space's channels, or the person's direct messages) and the open channel with its member
 * list. Agents are not in the column; mention one in a message to ask it for work.
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
  const space = useSpacesStore((s) => s.spaces.find((item) => item.id === spaceId));
  const canManageChannels = spaceCan(space, "channels.manage") || isOwner;
  const [editing, setEditing] = useState<SpaceConversation | null>();
  const [directMessageOpen, setDirectMessageOpen] = useState(false);
  const [addingPeople, setAddingPeople] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const ownAgents = useOwnMentionableAgents(user?.id);
  const openConversation = data.conversations.find((item) => item.id === conversationId);
  const openDirect = openConversation?.kind === "dm" ? openConversation : undefined;
  const openGroup =
    openDirect && isGroupDirectMessage(openDirect, user?.id) ? openDirect : undefined;
  const [deleting, setDeleting] = useState<SpaceConversation | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [spaceDialog, setSpaceDialog] = useState<SpaceDialog>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  // The search Enter ran in the bar, and what is typed there now.
  const [searchText, setSearchText] = useState("");
  const [searchedText, setSearchedText] = useState("");
  const closeSearch = () => {
    setSearchText("");
    setSearchedText("");
  };
  // Search results, then an open thread, take the member list's place, as in Fluxer.
  const threadOpen = useChatSidePanel((panel) => Boolean(panel.threadRootId));
  const threadsListOpen = useChatSidePanel((panel) => panel.threadsListOpen);
  const preferences = useChatSidebarPreferences((state) => state.value);
  const savePreferences = useChatSidebarPreferences((state) => state.set);
  const membersShown = !preferences.hideMembers;
  const deletableConversationIds = useMemo(
    () =>
      canManageChannels
        ? data.conversations
            .filter((conversation) => conversation.kind !== "dm")
            .map((conversation) => conversation.id)
        : [],
    [data.conversations, canManageChannels],
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
    if (bulkDeleting || !canManageChannels || !ids.length) return;
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

  const actions: ActionBarItem[] = [
    {
      id: "members",
      icon: Users,
      label: "Members",
      variant: "quiet",
      pressed: membersShown && !searchedText && !threadOpen && !threadsListOpen,
      priority: 3,
      onSelect: () => {
        closeSearch();
        useChatSidePanel.getState().reset();
        savePreferences((current) => ({ ...current, hideMembers: membersShown }));
      },
    },
    {
      id: "threads",
      icon: MessagesSquare,
      label: "Threads",
      variant: "quiet",
      pressed: threadsListOpen || threadOpen,
      priority: 3,
      onSelect: () => {
        closeSearch();
        const panel = useChatSidePanel.getState();
        if (panel.threadsListOpen || panel.threadRootId) panel.reset();
        else panel.openThreadsList();
      },
    },
  ];
  if (openGroup && !referenceOnly)
    actions.push({
      id: "add-people",
      icon: UserPlus,
      label: "Add people",
      variant: "quiet",
      priority: 2,
      onSelect: () => setAddingPeople(true),
    });
  if (openDirect && !referenceOnly)
    actions.push({
      id: "chat-agents",
      icon: Bot,
      label: "Agents in this chat",
      variant: "quiet",
      priority: 2,
      onSelect: () => setAgentsOpen(true),
    });
  if (openGroup && !referenceOnly)
    actions.push({
      id: "leave-group",
      icon: LogOut,
      label: "Leave group",
      variant: "quiet",
      priority: 1,
      onSelect: () => setLeaving(true),
    });
  const leaveGroup = async () => {
    if (!openGroup) return;
    setLeaveError("");
    try {
      await spacesApi.leaveConversation(spaceId, openGroup.id);
      data.remove(openGroup.id);
      setLeaving(false);
      navigate(spaceChatPath(spaceId));
    } catch (reason) {
      setLeaveError(reason instanceof Error ? reason.message : "You couldn't leave the group.");
    }
  };
  if (space && spaceCan(space, "space.invite") && !referenceOnly)
    actions.push({
      id: "invite",
      icon: UserPlus,
      label: "Invite people",
      variant: "quiet",
      priority: 2,
      onSelect: () => setSpaceDialog("invite"),
    });
  if (space && spaceCan(space, "roles.manage") && !referenceOnly)
    actions.push({
      id: "roles",
      icon: ShieldCheck,
      label: "Roles",
      variant: "quiet",
      priority: 1,
      onSelect: () => setRolesOpen(true),
    });

  const select = (next: string) =>
    navigate(
      next === "everyone" ? spaceChatPath(spaceId) : spaceChatConversationPath(spaceId, next),
    );

  return (
    <Surface tone="page" className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <PageHeader
        title={<SpaceCrumb spaceId={spaceId} here="Chat" />}
        actions={actions}
        actionsLabel="Chat actions"
        end={
          <SearchField
            containerClassName="w-56"
            aria-label="Search messages"
            placeholder="Search messages"
            value={searchText}
            onChange={(event) => {
              setSearchText(event.target.value);
              if (!event.target.value) setSearchedText("");
            }}
            onClear={closeSearch}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setSearchedText(searchText.trim());
              }
            }}
          />
        }
      />
      {space ? (
        <>
          <SpaceDialogs space={space} open={spaceDialog} onClose={() => setSpaceDialog(null)} />
          <RolesDialog space={space} open={rolesOpen} onOpenChange={setRolesOpen} />
        </>
      ) : null}
      <FluxerChatRoot className={cx(guildLayout.guildLayoutContent, shell.layout)}>
        {space ? (
          <FluxerSidebar
            space={space}
            conversations={data.conversations}
            everyoneUnread={everyoneUnread}
            loading={data.loading}
            currentUserId={user?.id}
            selected={conversationId || "everyone"}
            canWrite={!referenceOnly}
            canManageChannels={canManageChannels && !referenceOnly}
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
        ) : null}
        <SpaceChat {...props} searchedText={searchedText} />
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
        {openGroup ? (
          <AddPeopleDialog
            spaceId={spaceId}
            conversation={openGroup}
            members={members ?? []}
            open={addingPeople}
            onOpenChange={setAddingPeople}
            onChanged={(changed) => data.upsert(changed)}
          />
        ) : null}
        {openDirect ? (
          <ConversationAgentsDialog
            spaceId={spaceId}
            conversation={openDirect}
            currentUserId={user?.id}
            agents={ownAgents}
            open={agentsOpen}
            onOpenChange={setAgentsOpen}
            onChanged={() => void reloadSpaceConversations(spaceId).catch(() => undefined)}
          />
        ) : null}
        <AlertDialog open={leaving} onOpenChange={(next) => !next && setLeaving(false)}>
          <AlertDialogContent>
            <AlertDialogTitle>Leave this group?</AlertDialogTitle>
            <AlertDialogDescription>
              {leaveError ||
                "You and your agents leave. What you wrote stays, and someone can add you back."}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void leaveGroup();
                }}
              >
                Leave
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
      </FluxerChatRoot>
    </Surface>
  );
}
