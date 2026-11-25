import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  FieldError,
  Input,
  PersonRow,
  RowGroupLabel,
  RowGroupSection,
  SearchField,
  SkeletonList,
  notify,
} from "@misty/ui";
import { spacesApi } from "../api/api";
import type { Space } from "../api/dto/entities";
import { useSpacesStore } from "../list/use_spaces_store";
import { spaceNavigationName } from "../routes/default_space";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { PersonFace } from "./PersonFace";
import { reloadSpaceInvitations, useFriendPeople, useSpaceInvitations } from "./space_people";

const inviteLabels = ["Invite", "Sent"] as const;

export function InviteDialog(props: {
  space: Space;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>{`Invite to ${spaceNavigationName(props.space)}`}</DialogTitle>
        </DialogHeader>
        {props.open ? <InviteBody space={props.space} /> : null}
        <DialogFooter>
          <Button variant="primary" size="lg" onClick={() => props.onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteBody({ space }: { space: Space }) {
  const friends = useFriendPeople();
  const invitations = useSpaceInvitations(space.id, true);
  const members = useSpacesStore((state) => state.membersBySpace[space.id]);
  const [query, setQuery] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!members) void useSpacesStore.getState().loadMembers(space.id).catch(() => undefined);
  }, [members, space.id]);

  const here = new Set((members ?? []).map((member) => member.user_id));
  const invited = new Set([
    ...sent,
    ...(invitations.data ?? []).flatMap((item) =>
      item.invited_user_id ? [item.invited_user_id] : [],
    ),
  ]);
  const needle = query.trim().toLowerCase();
  const people = (friends.data?.friends ?? [])
    .filter((person) => !here.has(person.user_id))
    .filter((person) => !needle || person.username.toLowerCase().includes(needle));

  const inviteFriend = async (userId: string, name: string) => {
    setBusy(userId);
    try {
      await spacesApi.inviteFriend(space.id, userId);
      setSent((current) => [...current, userId]);
      void reloadSpaceInvitations(space.id).catch(() => undefined);
    } catch (cause) {
      notify({
        message: cause instanceof Error ? cause.message : `${name} couldn't be invited. Try again.`,
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  };

  const sendEmail = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address || sending) return;
    setSending(true);
    setEmailError("");
    try {
      const invite = await spacesApi.invite(space.id, address);
      setEmail("");
      void reloadSpaceInvitations(space.id).catch(() => undefined);
      const link = invite.link;
      notify({
        message: `Invitation sent to ${address}`,
        action: link
          ? {
              label: "Copy link",
              onSelect: () => void navigator.clipboard?.writeText(link).catch(() => undefined),
            }
          : undefined,
      });
    } catch (cause) {
      setEmailError(
        cause instanceof Error ? cause.message : "The invitation wasn't sent. Try again.",
      );
    } finally {
      setSending(false);
    }
  };

  const friendList = () => {
    if (!friends.data && friends.loading)
      return (
        <RowGroupSection title="Friends">
          <SkeletonList label="Loading friends" rows={3} leading="avatar" trailing />
        </RowGroupSection>
      );
    if (!friends.data)
      return (
        <ErrorState
          inline
          title="Your friends couldn't load"
          action={{ label: "Try again", onClick: () => void friends.reload() }}
        />
      );
    if (!friends.data.friends.some((person) => !here.has(person.user_id))) return null;
    return (
      <RowGroupSection title="Friends">
        {people.map((person) => {
          const done = invited.has(person.user_id);
          return (
            <PersonRow
              key={person.user_id}
              face={
                <PersonFace
                  id={person.user_id}
                  name={person.username}
                  pictureVersion={person.avatar_version}
                  outline={avatarOutline(person.avatar_decoration)}
                />
              }
              name={person.username}
              actions={
                <Button
                  size="sm"
                  widthOf={inviteLabels}
                  disabled={done || busy === person.user_id}
                  onClick={() => void inviteFriend(person.user_id, person.username)}
                >
                  {done ? "Sent" : "Invite"}
                </Button>
              }
            />
          );
        })}
      </RowGroupSection>
    );
  };

  const hasFriends = (friends.data?.friends ?? []).some((person) => !here.has(person.user_id));

  return (
    <DialogBody className="grid gap-4">
      {hasFriends ? (
        <SearchField
          aria-label="Search friends"
          placeholder="Search friends"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      {friendList()}
      <form className="grid gap-1.5" onSubmit={(event) => void sendEmail(event)}>
        <RowGroupLabel title="Email" />
        <div className="flex gap-2">
          <Input
            type="email"
            aria-label="Email"
            aria-describedby={emailError ? "invite-email-error" : undefined}
            aria-invalid={emailError ? true : undefined}
            autoComplete="email"
            placeholder="name@example.com"
            className="min-w-0 flex-1"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError("");
            }}
          />
          <Button type="submit" disabled={sending || !email.trim()}>
            Send
          </Button>
        </div>
        <FieldError id="invite-email-error" message={emailError || undefined} />
      </form>
    </DialogBody>
  );
}
