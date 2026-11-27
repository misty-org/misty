import { useEffect, useState } from "react";
import { Bot, LogOut, UserPlus, type LucideIcon } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/features/account";
import { useSpacesStore } from "../list/use_spaces_store";
import { useChatBar } from "./components/ChatBarButtons";
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
  MenuItem,
} from "@misty/ui";
import { useSpaceConversations } from "./sidebar/use_space_conversations";
import { reloadSpaceConversations } from "./space_conversations_resource";
import { SpaceChat } from "./SpaceChat";

type ChatAction = {
  id: string;
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  danger?: boolean;
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
      danger: true,
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

  const moreRows = actions.length
    ? actions.map((action) => (
        <MenuItem
          key={action.id}
          icon={action.icon}
          label={action.label}
          danger={action.danger}
          onSelect={action.onSelect}
        />
      ))
    : undefined;
  const bar = useChatBar({
    spaceId,
    conversationId,
    muteId: chatMuteId(spaceId, conversationId),
    more: moreRows,
  });

  return (
    <>
      <SpaceChat
        {...props}
        searchedText={bar.searchedText}
        onCloseSearch={bar.closeSearch}
        actions={bar.actions}
        search={bar.search}
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
