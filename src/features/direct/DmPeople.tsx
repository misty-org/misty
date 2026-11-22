import { CircleUserRound, Users } from "lucide-react";
import {
  ChannelWelcome,
  PersonProfile,
  PersonProfileSection,
  PresenceFace,
  Text,
  type AvatarSize,
} from "@misty/ui";
import { ChatAvatar, useMemberPicture } from "@/features/spaces";
import type { DirectConversation, Person } from "./api";
import { CallButton } from "./calls/CallButtons";
import { useFriends } from "./directData";
import { useCustomStatus, usePresence } from "./statusStore";

/** What a one-to-one DM's side panel is: the other person's profile. */
export const profileIcon = CircleUserRound;

const longDate = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** Someone in a DM as their face: their picture (or initials in their tone) with their status. */
export function DmFace({
  dmId,
  person,
  size,
}: {
  dmId: string;
  person: Person;
  size?: AvatarSize;
}) {
  const presence = usePresence(person.user_id);
  const picture = useMemberPicture(dmId, person.user_id, person.avatar_version);
  return (
    <PresenceFace presence={presence} size={size === "xl" ? "lg" : "default"}>
      <ChatAvatar
        id={person.user_id}
        name={person.username}
        src={picture ?? undefined}
        size={size}
      />
    </PresenceFace>
  );
}

/** The opening of a DM's history: the person it's with, or the group and its people. */
export function DmWelcome({
  dm,
  name,
  other,
}: {
  dm: DirectConversation;
  name: string;
  other: Person | undefined;
}) {
  const call = dm.read_only ? undefined : <CallButton dmId={dm.id} />;
  if (dm.kind === "group" || !other)
    return (
      <ChannelWelcome
        icon={Users}
        title={name}
        line={`This is the beginning of the ${name} group.`}
        actions={call}
      />
    );
  return (
    <ChannelWelcome
      mark={<DmFace dmId={dm.id} person={other} size="xl" />}
      title={other.username}
      line={`This is the beginning of your direct message history with ${other.username}.`}
      actions={call}
    />
  );
}

/** The other person's profile beside a one-to-one DM, where a group lists its people. */
export function DmProfile({ dm, person }: { dm: DirectConversation; person: Person }) {
  const custom = useCustomStatus(person.user_id);
  const friends = useFriends();
  const friend = friends.data?.friends.find((item) => item.user_id === person.user_id);
  const since = friend?.since ? new Date(friend.since) : undefined;
  return (
    <PersonProfile
      label="Profile"
      face={<DmFace dmId={dm.id} person={person} size="xl" />}
      name={person.username}
      line={custom || undefined}
    >
      {since && !Number.isNaN(since.getTime()) ? (
        <PersonProfileSection title="Friends since">
          <Text size="control">{longDate.format(since)}</Text>
        </PersonProfileSection>
      ) : null}
    </PersonProfile>
  );
}
