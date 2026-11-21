import { useEffect, useState } from "react";
import {
  Bot,
  LogOut,
  MoreHorizontal,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/features/account";
import { useSpacesStore } from "../list/useSpacesStore";
import { ChatBarButtons } from "./components/ChatBarButtons";
import { chatMuteId } from "@/shared/lib/messageNotices";
import { spaceChatPath } from "./chatRoute";
import { AddPeopleDialog, ConversationAgentsDialog } from "./sidebar/GroupDirectDialogs";
import { isGroupDirectMessage } from "./sidebar/conversationGroups";
import { useOwnMentionableAgents } from "./ownAgents";
import { spacesApi } from "../api/api";
import { SpaceDialogs, type SpaceDialog } from "../components/space-row/SpaceDialogs";
import { RolesDialog } from "../roles/RolesDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  ChannelPage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  SearchField,
  type ActionBarItem,
} from "@misty/ui";
import { useSpaceConversations } from "./sidebar/useSpaceConversations";
import { reloadSpaceConversations } from "./spaceConversationsResource";
import { SpaceChat } from "./SpaceChat";
import { spaceCan } from "../roles/useSpaceRoles";

/** One of the chat's controls: an icon of its own, its label, and what it does. */
type ChatAction = {
  id: string;
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  onSelect: () => void;
};

/**
 * A Space's chat, one of its pages, in Discord's layout from @misty/ui's channel pieces: the open
 * channel with its member list beside it. Its channels and direct messages are listed in the
 * window's sidebar, which also makes, edits and deletes them; the chat's controls and message
 * search sit at the end of the chat's own bar under the window's tabs (`ChannelHeader`). Mention an
 * agent in a message to ask it for work.
 */
export function SpaceChatEntry(props: React.ComponentProps<typeof SpaceChat>) {
  const { spaceId } = props;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const conversationId = params.get("conversation") ?? "";
  const data = useSpaceConversations(spaceId);
  const referenceOnly = useSpacesStore((s) => s.referenceOnly);
  const members = useSpacesStore((s) => s.membersBySpace[spaceId]);
  const loadMembers = useSpacesStore((s) => s.loadMembers);
  const nodesLoaded = useSpacesStore((s) => Boolean(s.nodesBySpace[spaceId]));
  const loadNodes = useSpacesStore((s) => s.loadNodes);
  const space = useSpacesStore((s) => s.spaces.find((item) => item.id === spaceId));
  const [addingPeople, setAddingPeople] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const ownAgents = useOwnMentionableAgents(user?.id);
  const openConversation = data.conversations.find((item) => item.id === conversationId);
  const openDirect = openConversation?.kind === "dm" ? openConversation : undefined;
  const openGroup =
    openDirect && isGroupDirectMessage(openDirect, user?.id) ? openDirect : undefined;
  const [spaceDialog, setSpaceDialog] = useState<SpaceDialog>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  // The search Enter ran in the bar, and what is typed there now.
  const [searchText, setSearchText] = useState("");
  const [searchedText, setSearchedText] = useState("");
  const closeSearch = () => {
    setSearchText("");
    setSearchedText("");
  };
  useEffect(() => {
    if (!members) void loadMembers(spaceId).catch(() => {});
  }, [members, loadMembers, spaceId]);
  // Attachments name their files from the Space's nodes, which realtime only refreshes.
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
  if (space && spaceCan(space, "space.invite") && !referenceOnly)
    actions.push({
      id: "invite",
      icon: UserPlus,
      label: "Invite people",
      onSelect: () => setSpaceDialog("invite"),
    });
  if (space && spaceCan(space, "roles.manage") && !referenceOnly)
    actions.push({
      id: "roles",
      icon: ShieldCheck,
      label: "Roles",
      onSelect: () => setRolesOpen(true),
    });

  // The chat's own buttons stay in view at the end of its bar, beside the search, in Discord's
  // order (ChatBarButtons); the rest are under ⋯.
  const moreRows = actions.map((action) => (
    <MenuItem key={action.id} icon={action.icon} label={action.label} onSelect={action.onSelect} />
  ));
  const barActions: ActionBarItem[] = [
    ...(actions.length
      ? [
          {
            id: "more",
            icon: MoreHorizontal,
            label: "More",
            priority: 1,
            // Folded into the bar's own ⋯, the same rows open as a submenu.
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
    <>
      <ChatBarButtons
        spaceId={spaceId}
        conversationId={conversationId}
        muteId={chatMuteId(spaceId, conversationId)}
        searching={Boolean(searchedText)}
        onPanel={closeSearch}
      />
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
    </>
  );

  return (
    <ChannelPage>
      {space ? (
        <>
          <SpaceDialogs space={space} open={spaceDialog} onClose={() => setSpaceDialog(null)} />
          <RolesDialog space={space} open={rolesOpen} onOpenChange={setRolesOpen} />
        </>
      ) : null}
      <SpaceChat {...props} searchedText={searchedText} actions={barActions} search={search} />
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
    </ChannelPage>
  );
}
