import { useId, useState, type FormEvent } from "react";
import { Ban, Check, MessageCircle, ShieldOff, Trash2, UserPlus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  AvatarFallback,
  Button,
  CollectionFilters,
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

type Section = "online" | "all" | "pending" | "blocked";

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
 * The person's friends, as Discord's Friends page: Online, All, Pending and Blocked, and Add
 * friend, which sends a request by username.
 */
export function FriendsPage() {
  const navigate = useNavigate();
  const friends = useFriends();
  const statuses = useStatusStore((state) => state.byUser);
  const [section, setSection] = useState<Section>("online");
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
  if (section === "pending" && incoming.length)
    actions.unshift({
      id: "clear-incoming",
      icon: X,
      label: "Clear all",
      variant: "quiet",
      priority: 2,
      onSelect: () =>
        void act(() => directApi.clearIncomingRequests(), "The requests couldn't be cleared."),
    });

  const options = [
    { value: "online", label: "Online" },
    { value: "all", label: "All" },
    { value: "pending", label: incoming.length ? `Pending ${incoming.length}` : "Pending" },
    { value: "blocked", label: "Blocked" },
  ];

  const body = () => {
    if (!list && friends.loading)
      return <ListRowSkeleton label="Loading friends" leading lines={2} trailing="icon" />;
    if (!list)
      return (
        <ErrorState
          inline
          title="Your friends couldn't be loaded"
          action={{ label: "Try again", onClick: () => void reloadFriends().catch(() => undefined) }}
        />
      );
    if (section === "online" || section === "all") {
      const shown =
        section === "all"
          ? list.friends
          : list.friends.filter(
              (person) => (statuses[person.user_id]?.status ?? "offline") !== "offline",
            );
      if (!shown.length)
        return list.friends.length ? (
          <EmptyState inline title="No one is online" line="Friends who are online show here." />
        ) : (
          <EmptyState inline title="No friends yet" line="Add a friend by their username." />
        );
      return shown.map((person) => (
        <FriendRow
          key={person.user_id}
          person={person}
          onMessage={(who) => void message(who)}
          onRemove={remove}
          onBlock={block}
        />
      ));
    }
    if (section === "pending") {
      if (!incoming.length && !list.outgoing.length)
        return <EmptyState inline title="No pending requests" line="Requests to and from you show here." />;
      return (
        <>
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
        </>
      );
    }
    if (!list.blocked.length)
      return <EmptyState inline title="No one is blocked" line="People you block show here." />;
    return list.blocked.map((person) => (
      <ListRow
        key={person.user_id}
        label={person.username}
        leading={<PersonFace person={person} />}
        trailing={
          <IconButton
            label="Unblock"
            onClick={() =>
              void act(() => directApi.unblock(person.user_id), "They couldn't be unblocked.")
            }
          >
            <ShieldOff />
          </IconButton>
        }
      />
    ));
  };

  return (
    <CollectionPage>
      <CollectionHeading actions={actions} actionsLabel="Friends actions" />
      <CollectionFilters
        options={options}
        value={section}
        onChange={(value) => setSection(value as Section)}
      />
      {adding ? <AddFriendRow /> : null}
      <div className="flex w-full max-w-3xl flex-col">{body()}</div>
      {dialog}
    </CollectionPage>
  );
}
