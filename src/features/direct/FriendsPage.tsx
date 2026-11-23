import { useId, useState, type FormEvent } from "react";
import { Ban, MessageCircle, Phone, ShieldOff, Trash2, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  CopyButton,
  EmptyState,
  ErrorState,
  FieldError,
  FramedBar,
  FramedPage,
  IconButton,
  Input,
  ListRowSkeleton,
  MenuItem,
  PersonRow,
  Popover,
  PopoverActions,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  RowGroupSection,
  RowGroupStack,
  SearchField,
  Text,
  notify,
  useConfirmDelete,
} from "@misty/ui";
import { ApiRequestError } from "@/api/client";
import { useUserStore } from "@/features/account";
import { directApi, type Person, type PresenceStatus } from "./api";
import { dmPath, reloadDms, reloadFriends, useFriends } from "./direct_data";
import { ActiveNow, Face, activityLine, useActivities, type Activity } from "./FriendsActivity";
import { useCallStore } from "./calls/call_store";
import { useCustomStatus, usePresence, useStatusStore } from "./status_store";

const statusWords: Record<PresenceStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Offline",
};

function failure(reason: unknown, fallback: string) {
  notify({ tone: "error", message: reason instanceof Error ? reason.message : fallback });
}

function FriendRow(props: {
  person: Person;
  activity?: Activity;
  onMessage: (person: Person) => void;
  onCall: (person: Person) => void;
  onRemove: (person: Person) => void;
  onBlock: (person: Person) => void;
}) {
  const { person } = props;
  const presence = usePresence(person.user_id);
  const custom = useCustomStatus(person.user_id);
  const away = presence === "offline";
  const line = away
    ? statusWords.offline
    : (activityLine(props.activity) ?? (custom || statusWords[presence]));
  return (
    <PersonRow
      face={<Face userId={person.user_id} name={person.username} />}
      name={person.username}
      line={line}
      away={away}
      onOpen={() => props.onMessage(person)}
      tools={
        <>
          <IconButton label="Message" onClick={() => props.onMessage(person)}>
            <MessageCircle />
          </IconButton>
          <IconButton label="Call" onClick={() => props.onCall(person)}>
            <Phone />
          </IconButton>
        </>
      }
      menu={
        <>
          <MenuItem
            icon={Trash2}
            label="Remove friend"
            danger
            onSelect={() => props.onRemove(person)}
          />
          <MenuItem icon={Ban} label="Block" danger onSelect={() => props.onBlock(person)} />
        </>
      }
    />
  );
}

function AddFriendForm(props: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const mine = useUserStore((state) => state.me?.username ?? "");
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const name = username.trim();
    if (!name || sending) return;
    setError("");
    setSending(true);
    try {
      await directApi.sendFriendRequest(name);
      setUsername("");
      notify({ message: "Friend request sent" });
      void reloadFriends().catch(() => undefined);
      props.onDone();
    } catch (reason) {
      if (
        reason instanceof ApiRequestError &&
        (reason.code === "friend_request_limit_reached" || reason.status === 429)
      )
        setError("You've sent too many requests today. Try again tomorrow.");
      else setError(reason instanceof Error ? reason.message : "The request couldn't be sent.");
    } finally {
      setSending(false);
    }
  };
  return (
    <form onSubmit={(event) => void send(event)}>
      <PopoverHeader title="Add friend" />
      <PopoverBody>
        <Input
          id={fieldId}
          autoFocus
          value={username}
          placeholder="Username"
          aria-label="Username"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setUsername(event.target.value);
            setError("");
          }}
        />
        <FieldError id={errorId} message={error || undefined} />
        {mine ? (
          <div className="flex min-w-0 items-center gap-1">
            <Text size="meta" tone="muted">
              {`Your username is ${mine}`}
            </Text>
            <CopyButton label="Copy your username" value={mine} />
          </div>
        ) : null}
      </PopoverBody>
      <PopoverActions>
        <Button variant="quiet" type="button" onClick={props.onDone}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!username.trim() || sending}>
          Send request
        </Button>
      </PopoverActions>
    </form>
  );
}

export function FriendsPage() {
  const navigate = useNavigate();
  const friends = useFriends();
  const statuses = useStatusStore((state) => state.byUser);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const { confirm, dialog } = useConfirmDelete();
  const list = friends.data;
  const incoming = list?.incoming ?? [];
  const everyone = list?.friends ?? [];
  const activities = useActivities(everyone);

  const message = async (person: Person) => {
    try {
      const dm = await directApi.openDm(person.user_id);
      void reloadDms().catch(() => undefined);
      navigate(dmPath(dm.id));
    } catch (reason) {
      failure(reason, "The conversation couldn't be opened.");
    }
  };
  const call = async (person: Person) => {
    try {
      const dm = await directApi.openDm(person.user_id);
      void reloadDms().catch(() => undefined);
      navigate(dmPath(dm.id));
      await useCallStore.getState().start(dm.id, false);
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
      onMessage={(who) => void message(who)}
      onCall={(who) => void call(who)}
      onRemove={remove}
      onBlock={block}
    />
  );

  const requestFace = (person: Person) => <Face userId={person.user_id} name={person.username} />;

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
    if (!list.friends.length && !pending && !list.blocked.length)
      return (
        <EmptyState
          title="No friends yet"
          line="Add someone by their username to message and call them."
          action={{ label: "Add friend", icon: UserPlus, onClick: () => setAdding(true) }}
        />
      );
    const shown = list.friends.filter(matches);
    const online = shown.filter(
      (person) => (statuses[person.user_id]?.status ?? "offline") !== "offline",
    );
    const offline = shown.filter((person) => !online.includes(person));
    return (
      <>
        {pending ? (
          <RowGroupSection
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
          </RowGroupSection>
        ) : null}
        {online.length ? (
          <RowGroupSection title="Online" count={online.length}>
            {online.map(friendRow)}
          </RowGroupSection>
        ) : null}
        {offline.length ? (
          <RowGroupSection title="Offline" count={offline.length}>
            {offline.map(friendRow)}
          </RowGroupSection>
        ) : null}
        {query.trim() && list.friends.length && !shown.length ? (
          <EmptyState inline title="No friends match" line={`Nobody called “${query.trim()}”.`} />
        ) : null}
        {list.blocked.length ? (
          <RowGroupSection title="Blocked" count={list.blocked.length}>
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
          </RowGroupSection>
        ) : null}
      </>
    );
  };

  const hasAny = Boolean(list && (list.friends.length || incoming.length || list.outgoing.length));

  return (
    <FramedPage
      autoSaveId="friends"
      toolbar={
        <FramedBar
          start={
            hasAny ? (
              <div className="w-64 min-w-0">
                <SearchField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search friends"
                  aria-label="Search friends"
                />
              </div>
            ) : null
          }
        >
          {hasAny || adding ? (
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
          ) : null}
        </FramedBar>
      }
      end={{
        id: "friends-active",
        label: "Resize the active column",
        width: 300,
        minWidth: 220,
        maxWidth: 420,
        content: <ActiveNow friends={everyone} activities={activities} />,
      }}
    >
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <RowGroupStack className="h-full w-full px-3 pt-4 pb-10">{body()}</RowGroupStack>
      </main>
      {dialog}
    </FramedPage>
  );
}
