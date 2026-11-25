import { useState } from "react";
import { MessageCircle, Phone, ShieldOff, UserPlus, Users, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  EmptyState,
  ErrorState,
  FaceStack,
  FramedBar,
  FramedPage,
  IconButton,
  ListRowSkeleton,
  PersonRow,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowGroupStack,
  SearchField,
  ToolbarDivider,
  notify,
  useConfirmDelete,
} from "@misty/ui";
import { directApi, type Person } from "./api";
import { dmPath, reloadDms, reloadFriends, useFriends } from "./direct_data";
import { AddPeopleDialog } from "./AddPeopleDialog";
import { DmProfile } from "./DmPeople";
import { Face, FriendNow, useActivities } from "./FriendsActivity";
import { AddFriendForm, FriendRow, FriendSection } from "./FriendsRows";
import { useAnyCall } from "./calls/agent_call_store";
import { useCallStore, useCallsAvailable } from "./calls/call_store";
import { useStatusStore } from "./status_store";

function failure(reason: unknown, fallback: string) {
  notify({ tone: "error", message: reason instanceof Error ? reason.message : fallback });
}

export function FriendsPage() {
  const navigate = useNavigate();
  const friends = useFriends();
  const statuses = useStatusStore((state) => state.byUser);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<{ startWith?: string } | null>(null);
  const callsAvailable = useCallsAvailable();
  const inCall = useAnyCall();
  const { confirm, dialog } = useConfirmDelete();
  const list = friends.data;
  const incoming = list?.incoming ?? [];
  const everyone = list?.friends ?? [];
  const activities = useActivities(everyone);
  const isOnline = (person: Person) =>
    (statuses[person.user_id]?.status ?? "offline") !== "offline";
  const onlineNow = everyone.filter(isOnline);
  const selected =
    everyone.find((person) => person.user_id === picked) ?? onlineNow[0] ?? everyone[0];
  const pick = (person: Person) => setPicked(person.user_id);
  const startGroup = (person?: Person) => setGrouping({ startWith: person?.user_id });

  const message = async (person: Person) => {
    try {
      const dm = await directApi.openDm(person.user_id);
      void reloadDms().catch(() => undefined);
      navigate(dmPath(dm.id));
    } catch (reason) {
      failure(reason, "The conversation couldn't be opened.");
    }
  };
  const call = async (person: Person, video: boolean) => {
    try {
      const dm = await directApi.openDm(person.user_id);
      void reloadDms().catch(() => undefined);
      navigate(dmPath(dm.id));
      await useCallStore.getState().start(dm.id, video);
    } catch (reason) {
      failure(reason, "The call couldn't be started.");
    }
  };
  const remove = (person: Person) =>
    void confirm({
      title: `Remove ${person.username} as a friend?`,
      what: `All your messages with ${person.username} will be deleted too.`,
      confirmLabel: "Remove",
      onConfirm: async () => {
        await directApi.unfriend(person.user_id);
        await Promise.all([reloadFriends(), reloadDms()]);
      },
    });
  const block = (person: Person) =>
    void confirm({
      title: `Block ${person.username}?`,
      what: `All your messages with ${person.username} will be deleted too.`,
      confirmLabel: "Block",
      onConfirm: async () => {
        await directApi.block(person.user_id);
        await Promise.all([reloadFriends(), reloadDms()]);
      },
    });
  const act = async (work: () => Promise<unknown>, fallback: string) => {
    try {
      await work();
      await reloadFriends();
    } catch (reason) {
      failure(reason, fallback);
    }
  };

  const matches = (person: Person) =>
    !query.trim() || person.username.toLowerCase().includes(query.trim().toLowerCase());

  const friendRow = (person: Person) => (
    <FriendRow
      key={person.user_id}
      person={person}
      activity={activities.get(person.user_id)}
      selected={person.user_id === selected?.user_id}
      onPick={pick}
      onGroup={startGroup}
      onMessage={(who) => void message(who)}
      onCall={(who) => void call(who, false)}
      onRemove={remove}
      onBlock={block}
    />
  );

  const requestFace = (person: Person) => (
    <Face userId={person.user_id} name={person.username} person={person} />
  );

  const body = () => {
    if (!list && friends.loading)
      return <ListRowSkeleton label="Loading friends" leading lines={2} trailing="icon" />;
    if (!list)
      return (
        <ErrorState
          inline
          title="Your friends couldn't be loaded"
          action={{
            label: "Try again",
            onClick: () => void reloadFriends().catch(() => undefined),
          }}
        />
      );
    const pending = incoming.length + list.outgoing.length;
    const shown = list.friends.filter(matches);
    if (query.trim() && !shown.length)
      return (
        <EmptyState inline title="No friends match" line={`Nobody called “${query.trim()}”.`} />
      );
    const online = shown.filter(isOnline);
    const offline = shown.filter((person) => !online.includes(person));
    return (
      <>
        <FriendSection
          title="Requests"
          count={pending}
          action={
            incoming.length
              ? {
                  label: "Clear all",
                  onSelect: () =>
                    void act(
                      () => directApi.clearIncomingRequests(),
                      "The requests couldn't be cleared.",
                    ),
                }
              : undefined
          }
        >
          {incoming.map((person) => (
            <PersonRow
              key={`in-${person.user_id}`}
              face={requestFace(person)}
              name={person.username}
              line="Wants to be your friend"
              actions={
                <>
                  <Button
                    size="sm"
                    onClick={() =>
                      void act(async () => {
                        await directApi.acceptFriendRequest(person.user_id);
                        void reloadDms().catch(() => undefined);
                      }, "The request couldn't be accepted.")
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      void act(
                        () => directApi.removeFriendRequest(person.user_id),
                        "The request couldn't be ignored.",
                      )
                    }
                  >
                    Ignore
                  </Button>
                </>
              }
            />
          ))}
          {list.outgoing.map((person) => (
            <PersonRow
              key={`out-${person.user_id}`}
              face={requestFace(person)}
              name={person.username}
              line="You sent a request"
              actions={
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() =>
                    void act(
                      () => directApi.removeFriendRequest(person.user_id),
                      "The request couldn't be cancelled.",
                    )
                  }
                >
                  Cancel
                </Button>
              }
            />
          ))}
        </FriendSection>
        <FriendSection title="Online" count={online.length}>
          {online.map(friendRow)}
        </FriendSection>
        <FriendSection title="Offline" count={offline.length}>
          {offline.map(friendRow)}
        </FriendSection>
        {list.blocked.length ? (
          <FriendSection title="Blocked" count={list.blocked.length}>
            {list.blocked.map((person) => (
              <PersonRow
                key={person.user_id}
                face={requestFace(person)}
                name={person.username}
                away
                tools={
                  <IconButton
                    label="Unblock"
                    onClick={() =>
                      void act(
                        () => directApi.unblock(person.user_id),
                        "They couldn't be unblocked.",
                      )
                    }
                  >
                    <ShieldOff />
                  </IconButton>
                }
              />
            ))}
          </FriendSection>
        ) : null}
      </>
    );
  };

  const selectedActivity = selected ? activities.get(selected.user_id) : undefined;

  return (
    <FramedPage
      autoSaveId="friends"
      header={
        <FramedBar
          start={
            list ? (
              <div className="flex min-w-0 items-center gap-4">
                <div className="w-64 min-w-0">
                  <SearchField
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search friends"
                    aria-label="Search friends"
                  />
                </div>
                {onlineNow.length ? (
                  <FaceStack
                    label={`${onlineNow.length} online`}
                    onSelect={setPicked}
                    people={onlineNow.map((person) => ({
                      id: person.user_id,
                      name: person.username,
                      face: (
                        <Face
                          userId={person.user_id}
                          name={person.username}
                          person={person}
                          size="sm"
                          bare
                        />
                      ),
                    }))}
                  />
                ) : null}
              </div>
            ) : null
          }
        >
          {list ? (
            <>
              <Button icon={Users} disabled={!everyone.length} onClick={() => startGroup()}>
                New group
              </Button>
              <ToolbarDivider />
              <Popover open={adding} onOpenChange={setAdding}>
                <PopoverTrigger asChild>
                  <Button variant="primary" icon={UserPlus}>
                    Add friend
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end">
                  <AddFriendForm onDone={() => setAdding(false)} />
                </PopoverContent>
              </Popover>
            </>
          ) : null}
        </FramedBar>
      }
      end={
        selected
          ? {
              id: "friends-profile",
              label: "Resize the profile",
              width: 324,
              minWidth: 260,
              maxWidth: 420,
              content: (
                <DmProfile
                  key={selected.user_id}
                  person={selected}
                  actions={
                    <>
                      <IconButton
                        label="Message"
                        variant="secondary"
                        onClick={() => void message(selected)}
                      >
                        <MessageCircle />
                      </IconButton>
                      {callsAvailable ? (
                        <>
                          <IconButton
                            label="Voice call"
                            variant="secondary"
                            disabled={inCall}
                            onClick={() => void call(selected, false)}
                          >
                            <Phone />
                          </IconButton>
                          <IconButton
                            label="Video call"
                            variant="secondary"
                            disabled={inCall}
                            onClick={() => void call(selected, true)}
                          >
                            <Video />
                          </IconButton>
                        </>
                      ) : null}
                    </>
                  }
                  now={
                    selectedActivity ? (
                      <FriendNow friends={everyone} activity={selectedActivity} />
                    ) : undefined
                  }
                  onRemove={() => remove(selected)}
                  onBlock={() => block(selected)}
                />
              ),
            }
          : null
      }
    >
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <RowGroupStack className="h-full w-full px-3 pt-4 pb-10">{body()}</RowGroupStack>
      </main>
      <AddPeopleDialog
        open={grouping !== null}
        startWith={grouping?.startWith}
        onOpenChange={(open) => {
          if (!open) setGrouping(null);
        }}
      />
      {dialog}
    </FramedPage>
  );
}
