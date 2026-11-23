import { useEffect, useState } from "react";
import {
  LogOut,
  MessagesSquare,
  MoreHorizontal,
  Phone,
  Trash2,
  UserPlus,
  Video,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  ErrorState,
  FramedPage,
  IconButton,
  IndicatorDot,
  MenuItem,
  MenuSeparator,
  PaneLoading,
  SearchField,
  Text,
  notify,
  useConfirmDelete,
  type ActionBarItem,
} from "@misty/ui";
import { useDirectUserId } from "./direct_account";
import { useWorkspaceViewTitle, type WorkspaceView } from "@/features/app-windows";
import { SpaceChat, useChatBarActions, useChatBarMenu, useSpacesStore } from "@/features/spaces";
import { DmMembers } from "./DmMembers";
import { DmFace, DmProfile, DmWelcome, profileIcon } from "./DmPeople";
import { directApi, type DirectConversation } from "./api";
import { AddPeopleDialog } from "./AddPeopleDialog";
import { dmOf, useCallStore, useCallsAvailable } from "./calls/call_store";
import { CallStageView } from "./calls/CallView";
import { useMissedCalls } from "./calls/missed_calls";
import { dmName, dmOthers, friendsRoute, reloadDms, updateDms, useDms } from "./direct_data";

export function DmView({ tab, dmId }: { tab: WorkspaceView; dmId: string }) {
  const dms = useDms();
  const listed = dms.data?.find((dm) => dm.id === dmId);
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
      <FramedPage>
        <ErrorState
          title="This conversation couldn't be opened"
          line={fetched.error instanceof Error ? fetched.error.message : undefined}
          action={{ label: "Try again", onClick: () => setAttempt((count) => count + 1) }}
        />
      </FramedPage>
    );
  return (
    <FramedPage>
      <PaneLoading label="Loading the conversation" />
    </FramedPage>
  );
}

function DmChat({ tab, dm }: { tab: WorkspaceView; dm: DirectConversation }) {
  const myId = useDirectUserId();
  const navigate = useNavigate();
  const name = dmName(dm, myId);
  const others = dmOthers(dm, myId);
  const group = dm.kind === "group";
  const other = group ? undefined : others[0];
  const callsAvailable = useCallsAvailable();
  const [addingPeople, setAddingPeople] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const { confirm, dialog } = useConfirmDelete();
  const [searchText, setSearchText] = useState("");
  const [searchedText, setSearchedText] = useState("");
  useWorkspaceViewTitle(tab.id, name);
  const missed = useMissedCalls((state) => state.byDm[dm.id]);
  const inCall = useCallStore((state) => dmOf(state.active) === dm.id);
  const anyCall = useCallStore((state) => Boolean(state.active));
  useEffect(() => useCallStore.getState().loadConfig(), []);

  useEffect(() => {
    void useSpacesStore
      .getState()
      .loadMembers(dm.id)
      .catch(() => undefined);
  }, [dm.id]);
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

  const closeSearch = () => {
    setSearchText("");
    setSearchedText("");
  };
  const menu = useChatBarMenu({ spaceId: dm.id, muteId: dm.id, onPanel: closeSearch });
  const sideActions = useChatBarActions({
    spaceId: dm.id,
    muteId: dm.id,
    searching: Boolean(searchedText),
    folded: true,
    sideLabel: group ? undefined : "Profile",
    SideIcon: group ? undefined : profileIcon,
    onPanel: closeSearch,
  });
  const moreRows = (
    <>
      <MenuItem icon={MessagesSquare} label={menu.threadsLabel} onSelect={menu.toggleThreads} />
      <MenuItem icon={menu.MuteIcon} label={menu.muteLabel} onSelect={menu.toggleMute} />
      {dm.read_only ? null : (
        <MenuItem icon={UserPlus} label="Add people" onSelect={() => setAddingPeople(true)} />
      )}
      <MenuSeparator />
      {group ? (
        <MenuItem icon={LogOut} label="Leave group" danger onSelect={leaveGroup} />
      ) : (
        <MenuItem icon={Trash2} label="Delete conversation" danger onSelect={deleteConversation} />
      )}
    </>
  );
  const startCall = (video: boolean) => void useCallStore.getState().start(dm.id, video);
  const actions: ActionBarItem[] = [
    ...(callsAvailable
      ? [
          {
            id: "voice-call",
            icon: Phone,
            label: "Voice call",
            priority: 6,
            disabled: anyCall,
            onSelect: () => startCall(false),
          },
          {
            id: "video-call",
            icon: Video,
            label: "Video call",
            priority: 6,
            disabled: anyCall,
            onSelect: () => startCall(true),
          },
        ]
      : []),
    ...sideActions,
    {
      id: "more",
      icon: MoreHorizontal,
      label: "More",
      priority: 9,
      menu: moreRows,
      render: () => (
        <DropdownMenu>
          <span className="relative inline-flex">
            <DropdownMenuTrigger asChild>
              <IconButton label="More" variant="quiet">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            {menu.threadsUnread > 0 ? <IndicatorDot /> : null}
          </span>
          <DropdownMenuContent align="end" aria-label="Conversation actions">
            {moreRows}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
  const search = (
    <SearchField
      containerClassName="w-40"
      aria-label="Search messages"
      placeholder="Search"
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
  const notice = missed ? (
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
  ) : undefined;
  const footer = dm.read_only ? (
    <div className="flex shrink-0 items-center gap-3 px-4 pb-3">
      <Text tone="muted" className="min-w-0 flex-1">
        {`You can message ${name} again once you're friends.`}
      </Text>
      <Button disabled={requesting} onClick={() => void addFriend()}>
        Add friend
      </Button>
    </div>
  ) : undefined;

  return (
    <>
      <SpaceChat
        spaceId={dm.id}
        spaceName={name}
        workspaceTabId={tab.id}
        searchedText={searchedText}
        onCloseSearch={closeSearch}
        actions={actions}
        search={search}
        dm={{
          name,
          group,
          readOnly: dm.read_only,
          face: other ? <DmFace dmId={dm.id} person={other} size="sm" /> : undefined,
          welcome: <DmWelcome dm={dm} name={name} other={other} />,
          members: other ? (
            <DmProfile dm={dm} person={other} />
          ) : (
            <DmMembers members={dm.members} me={myId ?? ""} />
          ),
          notice,
          footer,
        }}
        stage={inCall ? <CallStageView /> : undefined}
      />
      {!dm.read_only ? (
        <AddPeopleDialog dm={dm} open={addingPeople} onOpenChange={setAddingPeople} />
      ) : null}
      {dialog}
    </>
  );
}
