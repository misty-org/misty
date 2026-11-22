import { useId, useState, type FormEvent } from "react";
import { Ban, Check, MessageCircle, ShieldOff, Trash2, UserPlus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  AvatarFallback,
  Button,
  CollectionHeading,
  CollectionPage,
  EmptyState,
  ErrorState,
  FieldError,
  IconButton,
  Input,
  Label,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  PresenceFace,
  SectionHeading,
  notify,
  useConfirmDelete,
  type ActionBarItem,
} from "@misty/ui";
import { ApiRequestError } from "@/api/client";
import { personTone } from "@/shared/lib/personTone";
import { personInitials } from "@/shared/lib/personInitials";
import { directApi, type Person, type PresenceStatus } from "./api";
import { dmPath, reloadDms, reloadFriends, useFriends } from "./directData";
import { useCustomStatus, usePresence, useStatusStore } from "./statusStore";

const statusWords: Record<PresenceStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Offline",
};

function failure(reason: unknown, fallback: string) {
  notify({ tone: "error", message: reason instanceof Error ? reason.message : fallback });
}

/** A person's face with their status on its corner. */
function PersonFace({ person }: { person: Person }) {
  const presence = usePresence(person.user_id);
  return (
    <PresenceFace presence={presence}>
      <Avatar size="sm" tone={personTone(person.user_id)}>
        <AvatarFallback>{personInitials(person.username)}</AvatarFallback>
      </Avatar>
    </PresenceFace>
  );
}

/** A friend: their status line, Message, and Remove friend or Block under ⋯. */
function FriendRow(props: {
  person: Person;
  onMessage: (person: Person) => void;
  onRemove: (person: Person) => void;
  onBlock: (person: Person) => void;
}) {
  const { person } = props;
  const presence = usePresence(person.user_id);
  const custom = useCustomStatus(person.user_id);
  return (
    <ListRow
      label={person.username}
      leading={<PersonFace person={person} />}
      description={custom || statusWords[presence]}
      onOpen={() => props.onMessage(person)}
      trailing={
        <IconButton label="Message" onClick={() => props.onMessage(person)}>
          <MessageCircle />
        </IconButton>
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

/** Where friend requests are sent: a username, then Send request. */
function AddFriendRow() {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
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
    <form className="grid w-full max-w-3xl gap-1.5" onSubmit={(event) => void send(event)}>
      <Label htmlFor={fieldId}>Username</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={fieldId}
          autoFocus
          containerClassName="min-w-0 flex-1"
          value={username}
          placeholder="Username"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setUsername(event.target.value);
            setError("");
          }}
        />
        <Button type="submit" disabled={!username.trim() || sending}>
          Send request
        </Button>
      </div>
      <FieldError id={errorId} message={error || undefined} />
    </form>
  );
}

/**
 * The person's friends, grouped one under another: pending requests, then who is online, offline
 * and blocked, each under its heading with its count. Add friend sends a request by username.
 */
export function FriendsPage() {
  const navigate = useNavigate();
  const friends = useFriends();
  const statuses = useStatusStore((state) => state.byUser);
  const [adding, setAdding] = useState(false);
  const { confirm, dialog } = useConfirmDelete();
  const list = friends.data;
  const incoming = list?.incoming ?? [];

  const message = async (person: Person) => {
    try {
      const dm = await directApi.openDm(person.user_id);
      void reloadDms().catch(() => undefined);
      navigate(dmPath(dm.id));
    } catch (reason) {
      failure(reason, "The conversation couldn't be opened.");
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

  const actions: ActionBarItem[] = [
    {
      id: "add-friend",
      icon: UserPlus,
      label: "Add friend",
      variant: "primary",
      priority: 3,
      pressed: adding,
      onSelect: () => setAdding((open) => !open),
    },
  ];

  const friendRow = (person: Person) => (
    <FriendRow
      key={person.user_id}
      person={person}
      onMessage={(who) => void message(who)}
      onRemove={remove}
      onBlock={block}
    />
  );

  // Every group stacks under its heading, pending first, as Discord's friends list: no tabs.
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
      return <EmptyState inline title="No friends yet" line="Add a friend by their username." />;
    const online = list.friends.filter(
      (person) => (statuses[person.user_id]?.status ?? "offline") !== "offline",
    );
    const offline = list.friends.filter((person) => !online.includes(person));
    return (
      <>
        {pending ? (
          <section aria-label="Pending">
            <SectionHeading
              title="Pending"
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
            />
            {incoming.map((person) => (
              <ListRow
                key={`in-${person.user_id}`}
                label={person.username}
                leading={<PersonFace person={person} />}
                description="Incoming friend request"
                trailing={
                  <>
                    <IconButton
                      label="Accept"
                      onClick={() =>
                        void act(async () => {
                          await directApi.acceptFriendRequest(person.user_id);
                          void reloadDms().catch(() => undefined);
                        }, "The request couldn't be accepted.")
                      }
                    >
                      <Check />
                    </IconButton>
                    <IconButton
                      label="Ignore"
                      onClick={() =>
                        void act(
                          () => directApi.removeFriendRequest(person.user_id),
                          "The request couldn't be ignored.",
                        )
                      }
                    >
                      <X />
                    </IconButton>
                  </>
                }
              />
            ))}
            {list.outgoing.map((person) => (
              <ListRow
                key={`out-${person.user_id}`}
                label={person.username}
                leading={<PersonFace person={person} />}
                description="Outgoing friend request"
                trailing={
                  <IconButton
                    label="Cancel request"
                    onClick={() =>
                      void act(
                        () => directApi.removeFriendRequest(person.user_id),
                        "The request couldn't be cancelled.",
                      )
                    }
                  >
                    <X />
                  </IconButton>
                }
              />
            ))}
          </section>
        ) : null}
        {online.length ? (
          <section aria-label="Online">
            <SectionHeading title="Online" count={online.length} />
            {online.map(friendRow)}
          </section>
        ) : null}
        {offline.length ? (
          <section aria-label="Offline">
            <SectionHeading title="Offline" count={offline.length} />
            {offline.map(friendRow)}
          </section>
        ) : null}
        {list.blocked.length ? (
          <section aria-label="Blocked">
            <SectionHeading title="Blocked" count={list.blocked.length} />
            {list.blocked.map((person) => (
              <ListRow
                key={person.user_id}
                label={person.username}
                leading={<PersonFace person={person} />}
                trailing={
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
          </section>
        ) : null}
      </>
    );
  };

  return (
    <CollectionPage>
      <CollectionHeading actions={actions} actionsLabel="Friends actions" />
      {adding ? <AddFriendRow /> : null}
      <div className="flex w-full max-w-3xl flex-col gap-4">{body()}</div>
      {dialog}
    </CollectionPage>
  );
}
