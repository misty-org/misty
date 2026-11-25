import { useEffect, useState } from "react";
import { LogOut, Trash2, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  ErrorState,
  FramedPage,
  MenuItem,
  MenuSeparator,
  PaneLoading,
  Text,
  notify,
  useConfirmDelete,
} from "@misty/ui";
import { useDirectUserId } from "./direct_account";
import { useWorkspaceViewTitle, type WorkspaceView } from "@/features/app-windows";
import { SpaceChat, useChatBar, useSpacesStore } from "@/features/spaces";
import { DmMembers } from "./DmMembers";
import { DmFace, DmProfile, DmWelcome, profileIcon } from "./DmPeople";
import { directApi, type DirectConversation, type Person } from "./api";
import { AddPeopleDialog } from "./AddPeopleDialog";
import { useAnyCall } from "./calls/agent_call_store";
import { dmOf, useCallStore, useCallsAvailable } from "./calls/call_store";
import { CallStageView } from "./calls/CallView";
import { useMissedCalls } from "./calls/missed_calls";
import {
  dmName,
  dmOthers,
  friendsRoute,
  reloadDms,
  reloadFriends,
  updateDms,
  useDms,
} from "./direct_data";

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
  useWorkspaceViewTitle(tab.id, name);
  const missed = useMissedCalls((state) => state.byDm[dm.id]);
  const inCall = useCallStore((state) => dmOf(state.active) === dm.id);
  const anyCall = useAnyCall();
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
  const removeFriend = (person: Person) =>
    void confirm({
      title: `Remove ${person.username} as a friend?`,
      what: `All your messages with ${person.username} will be deleted too.`,
      confirmLabel: "Remove",
      onConfirm: async () => {
        await directApi.unfriend(person.user_id);
        await Promise.all([reloadFriends(), reloadDms()]);
        navigate(friendsRoute);
      },
    });
  const blockPerson = (person: Person) =>
    void confirm({
      title: `Block ${person.username}?`,
      what: `All your messages with ${person.username} will be deleted too.`,
      confirmLabel: "Block",
      onConfirm: async () => {
        await directApi.block(person.user_id);
        await Promise.all([reloadFriends(), reloadDms()]);
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

  const moreRows = (
    <>
      {dm.read_only ? null : (
        <>
          <MenuItem icon={UserPlus} label="Add people" onSelect={() => setAddingPeople(true)} />
          <MenuSeparator />
        </>
      )}
      {group ? (
        <MenuItem icon={LogOut} label="Leave group" danger onSelect={leaveGroup} />
      ) : (
        <MenuItem icon={Trash2} label="Delete conversation" danger onSelect={deleteConversation} />
      )}
    </>
  );
  const bar = useChatBar({
    spaceId: dm.id,
    muteId: dm.id,
    calls: callsAvailable
      ? {
          disabled: anyCall,
          start: (video) => void useCallStore.getState().start(dm.id, video),
        }
      : undefined,
    side: group ? undefined : { label: "Profile", icon: profileIcon },
    more: moreRows,
  });
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
        searchedText={bar.searchedText}
        onCloseSearch={bar.closeSearch}
        actions={bar.actions}
        search={bar.search}
        dm={{
          name,
          group,
          readOnly: dm.read_only,
          face: other ? <DmFace person={other} size="sm" /> : undefined,
          welcome: <DmWelcome dm={dm} name={name} other={other} />,
          members: other ? (
            <DmProfile
              person={other}
              onRemove={() => removeFriend(other)}
              onBlock={() => blockPerson(other)}
            />
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
