import { useEffect, useState } from "react";
import { Bot, LogOut, MoreHorizontal, UserPlus, type LucideIcon } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/features/account";
import { useSpacesStore } from "../list/use_spaces_store";
import { useChatBarActions } from "./components/ChatBarButtons";
import { chatMuteId } from "@/shared/lib/message_notices";
import { spaceChatPath } from "./chat_route";
import { loadSpaceMembers } from "./load_space_members";
import { AddPeopleDialog, ConversationAgentsDialog } from "./sidebar/GroupDirectDialogs";
import { isGroupDirectMessage } from "./sidebar/conversation_groups";
import { useOwnMentionableAgents } from "./own_agents";
import { spacesApi } from "../api/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  SearchField,
  type ActionBarItem,
} from "@misty/ui";
import { useSpaceConversations } from "./sidebar/use_space_conversations";
import { reloadSpaceConversations } from "./space_conversations_resource";
import { SpaceChat } from "./SpaceChat";

type ChatAction = {
  id: string;
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  onSelect: () => void;
};

export function SpaceChatEntry(props: React.ComponentProps<typeof SpaceChat>) {
  const { spaceId } = props;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const conversationId = params.get("conversation") ?? "";
  const data = useSpaceConversations(spaceId);
  const referenceOnly = useSpacesStore((s) => s.referenceOnly);
  const members = useSpacesStore((s) => s.membersBySpace[spaceId]);
  const nodesLoaded = useSpacesStore((s) => Boolean(s.nodesBySpace[spaceId]));
  const loadNodes = useSpacesStore((s) => s.loadNodes);
  const [addingPeople, setAddingPeople] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const ownAgents = useOwnMentionableAgents(user?.id);
  const openConversation = data.conversations.find((item) => item.id === conversationId);
  const openDirect = openConversation?.kind === "dm" ? openConversation : undefined;
  const openGroup =
    openDirect && isGroupDirectMessage(openDirect, user?.id) ? openDirect : undefined;
  const [searchText, setSearchText] = useState("");
  const [searchedText, setSearchedText] = useState("");
  const closeSearch = () => {
    setSearchText("");
    setSearchedText("");
  };
  useEffect(() => {
    if (!members) void loadSpaceMembers(spaceId).catch(() => {});
  }, [members, spaceId]);
  useEffect(() => {
    if (!nodesLoaded) void loadNodes(spaceId).catch(() => {});
  }, [nodesLoaded, loadNodes, spaceId]);

  const actions: ChatAction[] = [];
  if (openGroup && !referenceOnly)
    actions.push({
      id: "add-people",
      icon: UserPlus,
      label: "Add people",
      onSelect: () => setAddingPeople(true),
    });
  if (openDirect && !referenceOnly)
    actions.push({
      id: "chat-agents",
      icon: Bot,
      label: "Agents in this chat",
      onSelect: () => setAgentsOpen(true),
    });
  if (openGroup && !referenceOnly)
    actions.push({
      id: "leave-group",
      icon: LogOut,
      label: "Leave group",
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

  const sideActions = useChatBarActions({
    spaceId,
    conversationId,
    muteId: chatMuteId(spaceId, conversationId),
    searching: Boolean(searchedText),
    onPanel: closeSearch,
  });
  const moreRows = actions.map((action) => (
    <MenuItem key={action.id} icon={action.icon} label={action.label} onSelect={action.onSelect} />
  ));
  const barActions: ActionBarItem[] = [
    ...sideActions,
    ...(actions.length
      ? [
          {
            id: "more",
            icon: MoreHorizontal,
            label: "More",
            priority: 1,
            menu: moreRows,
            render: () => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="More" variant="quiet">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" aria-label="Chat actions">
                  {moreRows}
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]
      : []),
  ];
  const search = (
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
  );

  return (
    <>
      <SpaceChat
        {...props}
        searchedText={searchedText}
        onCloseSearch={closeSearch}
        actions={barActions}
        search={search}
      />
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
    </>
  );
}
