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
import { useFriends } from "./direct_data";
import { useCustomStatus, usePresence } from "./status_store";

export const profileIcon = CircleUserRound;

const longDate = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

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
    <PresenceFace presence={presence} face={size ?? "default"}>
      <ChatAvatar
        id={person.user_id}
        name={person.username}
        src={picture ?? undefined}
        size={size}
      />
    </PresenceFace>
  );
}

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
