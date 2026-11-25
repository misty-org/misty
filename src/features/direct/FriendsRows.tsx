import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Ban, MessageCircle, Phone, Trash2, Users } from "lucide-react";
import {
  Button,
  CopyButton,
  FieldError,
  IconButton,
  Input,
  MenuItem,
  PersonRow,
  PopoverActions,
  PopoverBody,
  PopoverHeader,
  SectionHeading,
  Text,
  notify,
  type SectionHeadingAction,
} from "@misty/ui";
import { ApiRequestError } from "@/api/client";
import { useUserStore } from "@/features/account";
import { directApi, type Person } from "./api";
import { reloadFriends } from "./direct_data";
import { Face, activityLine, type Activity } from "./FriendsActivity";
import { statusWords, useCustomStatus, usePresence } from "./status_store";

export function FriendSection(props: {
  title: string;
  count: number;
  action?: SectionHeadingAction;
  children?: ReactNode;
}) {
  return (
    <section aria-label={props.title} className="grid min-w-0 gap-0.5">
      <SectionHeading
        title={props.title}
        count={props.count}
        action={props.count ? props.action : undefined}
      />
      {props.children}
    </section>
  );
}

export function FriendRow(props: {
  person: Person;
  activity?: Activity;
  selected: boolean;
  onPick: (person: Person) => void;
  onGroup: (person: Person) => void;
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
      face={<Face userId={person.user_id} name={person.username} person={person} />}
      name={person.username}
      line={line}
      away={away}
      selected={props.selected}
      onOpen={() => props.onPick(person)}
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
            icon={Users}
            label={`New group with ${person.username}`}
            onSelect={() => props.onGroup(person)}
          />
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

export function AddFriendForm(props: { onDone: () => void }) {
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
