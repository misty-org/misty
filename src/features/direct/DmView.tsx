import { useEffect, useState } from "react";
import { LogOut, MoreHorizontal, Trash2, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  ChannelPage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  ErrorState,
  IconButton,
  MenuItem,
  PaneLoading,
  SearchField,
  Text,
  notify,
  useConfirmDelete,
  type ActionBarItem,
} from "@misty/ui";
import { useDirectUserId } from "./directAccount";
import { useWorkspaceViewTitle, type WorkspaceView } from "@/features/app-windows";
import { ChatBarButtons, SpaceChat, useSpacesStore } from "@/features/spaces";
import { DmMembers } from "./DmMembers";
import { directApi, type DirectConversation } from "./api";
import { AddPeopleDialog } from "./AddPeopleDialog";
import { CallButtons } from "./calls/CallButtons";
import { useMissedCalls } from "./calls/missedCalls";
import { dmName, dmOthers, friendsRoute, reloadDms, updateDms, useDms } from "./directData";

/**
 * A DM: its people's chat, which is the DM's own Space chat on the server, with Calls, Pinned,
 * Add people, a ⋯ to delete it (a one-to-one) or leave it (a group), and message search.
 */
export function DmView({ tab, dmId }: { tab: WorkspaceView; dmId: string }) {
  const dms = useDms();
  const listed = dms.data?.find((dm) => dm.id === dmId);
  // A DM not in the list yet (just made, or opened from a link) is read on its own.
  const [fetched, setFetched] = useState<{
    id: string;
    dm?: DirectConversation;
    error?: unknown;
  }>();
  const [attempt, setAttempt] = useState(0);
  const needsFetch = !listed && !dms.loading;
  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    setFetched(undefined);
    directApi
      .dm(dmId)
      .then((dm) => !cancelled && setFetched({ id: dmId, dm }))
      .catch((error: unknown) => !cancelled && setFetched({ id: dmId, error }));
    return () => {
      cancelled = true;
    };
  }, [needsFetch, dmId, attempt]);

  const dm = listed ?? (fetched?.id === dmId ? fetched.dm : undefined);
  if (dm) return <DmChat key={dm.id} tab={tab} dm={dm} />;
  if (fetched?.id === dmId && fetched.error)
    return (
      <ErrorState
        title="This conversation couldn't be opened"
        line={fetched.error instanceof Error ? fetched.error.message : undefined}
        action={{ label: "Try again", onClick: () => setAttempt((count) => count + 1) }}
      />
    );
  return <PaneLoading label="Loading the conversation" />;
}

function DmChat({ tab, dm }: { tab: WorkspaceView; dm: DirectConversation }) {
  const myId = useDirectUserId();
  const navigate = useNavigate();
  const name = dmName(dm, myId);
  const others = dmOthers(dm, myId);
  const group = dm.kind === "group";
  const [addingPeople, setAddingPeople] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const { confirm, dialog } = useConfirmDelete();
  // The search Enter ran in the bar, and what is typed there now.
  const [searchText, setSearchText] = useState("");
  const [searchedText, setSearchedText] = useState("");
  useWorkspaceViewTitle(tab.id, name);
  const missed = useMissedCalls((state) => state.byDm[dm.id]);

  // Mentions and names in the chat resolve from the DM's members.
  useEffect(() => {
    void useSpacesStore
      .getState()
      .loadMembers(dm.id)
      .catch(() => undefined);
  }, [dm.id]);
  // The chat marks itself read on the server; the list here shows it read at once.
  useEffect(() => {
    updateDms((current) =>
      current.map((item) => (item.id === dm.id ? { ...item, unread_count: 0 } : item)),
    );
  }, [dm.id]);

  const deleteConversation = () =>
    void confirm({
      title: "Delete this conversation?",
      what: "All its messages are deleted for both of you. This can't be undone.",
      onConfirm: async () => {
        await directApi.deleteDm(dm.id);
        await reloadDms().catch(() => undefined);
        navigate(friendsRoute);
      },
    });
  const leaveGroup = () =>
    void confirm({
      title: "Leave this group?",
      what: "You stop seeing this group and its messages. Someone can add you back.",
      confirmLabel: "Leave",
      onConfirm: async () => {
        await directApi.leaveDm(dm.id);
        await reloadDms().catch(() => undefined);
        navigate(friendsRoute);
      },
    });
  const addFriend = async () => {
    const username = others[0]?.username;
    if (!username || requesting) return;
    setRequesting(true);
    try {
      await directApi.sendFriendRequest(username);
      notify({ message: "Friend request sent" });
    } catch (reason) {
      notify({
        tone: "error",
        message: reason instanceof Error ? reason.message : "The request couldn't be sent.",
      });
    } finally {
      setRequesting(false);
    }
  };

  const moreRows = group ? (
    <MenuItem icon={LogOut} label="Leave group" danger onSelect={leaveGroup} />
  ) : (
    <MenuItem icon={Trash2} label="Delete conversation" danger onSelect={deleteConversation} />
  );
  const actions: ActionBarItem[] = [];
  if (!dm.read_only)
    actions.push({
      id: "add-people",
      icon: UserPlus,
      label: "Add people",
      priority: 2,
      onSelect: () => setAddingPeople(true),
    });
  actions.push({
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
        <DropdownMenuContent align="end" aria-label="Conversation actions">
          {moreRows}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  });
  // Calls and the chat's own buttons stay in view beside the search, which never folds.
  const end = (
    <>
      <CallButtons dmId={dm.id} />
      <ChatBarButtons
        spaceId={dm.id}
        muteId={dm.id}
        searching={Boolean(searchedText)}
        onPanel={() => {
          setSearchText("");
          setSearchedText("");
        }}
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
        onClear={() => {
          setSearchText("");
          setSearchedText("");
        }}
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
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {missed ? (
        // A call that came during Do not disturb, said once and quietly; it goes once seen.
        <div className="flex shrink-0 items-center gap-2 px-4 pt-2">
          <Text tone="muted" size="meta" className="min-w-0 flex-1">
            {`Missed ${missed.video ? "video" : "voice"} call from ${
              dm.members.find((member) => member.user_id === missed.from)?.username ?? "someone"
            } at ${new Date(missed.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
          </Text>
          <Button variant="quiet" size="sm" onClick={() => useMissedCalls.getState().seen(dm.id)}>
            Dismiss
          </Button>
        </div>
      ) : null}
      <ChannelPage className="min-h-0 flex-1">
        <SpaceChat
          spaceId={dm.id}
          spaceName={name}
          workspaceTabId={tab.id}
          searchedText={searchedText}
          actions={actions}
          search={end}
          dm={{
            name,
            group: dm.kind === "group",
            readOnly: dm.read_only,
            members: <DmMembers members={dm.members} me={myId ?? ""} />,
          }}
        />
      </ChannelPage>
      {dm.read_only ? (
        <div className="flex shrink-0 items-center gap-3 px-4 pb-3">
          <Text tone="muted" className="min-w-0 flex-1">
            {`You can message ${name} again once you're friends.`}
          </Text>
          <Button disabled={requesting} onClick={() => void addFriend()}>
            Add friend
          </Button>
        </div>
      ) : null}
      {!dm.read_only ? (
        <AddPeopleDialog dm={dm} open={addingPeople} onOpenChange={setAddingPeople} />
      ) : null}
      {dialog}
    </div>
  );
}
