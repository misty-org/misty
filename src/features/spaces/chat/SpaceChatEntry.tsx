import { useEffect, useState } from "react";
import {
  Bot,
  LogOut,
  MessagesSquare,
  MoreHorizontal,
  ShieldCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/features/account";
import { useSpacesStore } from "../list/useSpacesStore";
import { spaceChatPath } from "./chatRoute";
import { AddPeopleDialog, ConversationAgentsDialog } from "./sidebar/GroupDirectDialogs";
import { isGroupDirectMessage } from "./sidebar/conversationGroups";
import { useOwnMentionableAgents } from "./ownAgents";
import { spacesApi } from "../api/api";
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
  // Search results, then an open thread, take the member list's place.
  const threadOpen = useChatSidePanel((panel) => Boolean(panel.threadRootId));
  const threadsListOpen = useChatSidePanel((panel) => panel.threadsListOpen);
  const preferences = useChatSidebarPreferences((state) => state.value);
  const savePreferences = useChatSidebarPreferences((state) => state.set);
  const membersShown = !preferences.hideMembers;
  useEffect(() => {
    if (!members) void loadMembers(spaceId).catch(() => {});
  }, [members, loadMembers, spaceId]);
  // Attachments name their files from the Space's nodes, which realtime only refreshes.
  useEffect(() => {
    if (!nodesLoaded) void loadNodes(spaceId).catch(() => {});
  }, [nodesLoaded, loadNodes, spaceId]);

  const actions: ChatAction[] = [
    {
      id: "members",
      icon: Users,
      label: "Members",
      pressed: membersShown && !searchedText && !threadOpen && !threadsListOpen,
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
      pressed: threadsListOpen || threadOpen,
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

  // The chat's controls sit at the end of its own bar under the tabs, as Discord keeps a
  // channel's: Threads and Members as icons, the rest under ⋯, then search, which never folds.
  const cornerIds = ["threads", "members"];
  const corner = cornerIds.flatMap((id) => actions.filter((action) => action.id === id));
  const more = actions.filter((action) => !cornerIds.includes(action.id));
  const moreRows = more.map((action) => (
    <MenuItem key={action.id} icon={action.icon} label={action.label} onSelect={action.onSelect} />
  ));
  const barActions: ActionBarItem[] = [
    ...corner.map((action) => ({
      id: action.id,
      icon: action.icon,
      label: action.label,
      pressed: action.pressed,
      onSelect: action.onSelect,
      // Members stays longest, then Threads.
      priority: action.id === "members" ? 3 : 2,
    })),
    ...(more.length
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
