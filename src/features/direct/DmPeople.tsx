import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, Hand, Trash2, Users } from "lucide-react";
import {
  Button,
  ChannelWelcome,
  ErrorState,
  MemberRow,
  MenuItem,
  NavList,
  NavRow,
  OverflowFadeText,
  PersonProfile,
  PersonProfileSection,
  PresenceFace,
  profileIcons,
  SkeletonList,
  Text,
  type AvatarSize,
} from "@misty/ui";
import type { CachedResource } from "@/api/cache/cached_resource";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import {
  ChatAvatar,
  SpaceAvatar,
  spaceChatPath,
  useMemberPicture,
  useSpacesStore,
} from "@/features/spaces";
import type { DirectConversation, Person, SharedSpace } from "./api";
import { useFriends, useMutualFriends, useSharedSpaces } from "./direct_data";
import { useOpenDm } from "./DmMembers";
import { usePersonBanner } from "./person_banner";
import { useCustomStatus, usePresence } from "./status_store";

export const profileIcon = profileIcons.person;

const longDate = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function DmFace({ person, size }: { person: Person; size?: Exclude<AvatarSize, "glyph"> }) {
  const presence = usePresence(person.user_id);
  const picture = useMemberPicture(person.user_id, person.avatar_version);
  return (
    <PresenceFace presence={presence} face={size ?? "default"}>
      <ChatAvatar
        id={person.user_id}
        name={person.username}
        src={picture ?? undefined}
        size={size}
        outline={avatarOutline(person.avatar_decoration)}
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
  if (dm.kind === "group" || !other)
    return (
      <ChannelWelcome
        icon={Users}
        align="center"
        title={name}
        line={`This is the beginning of the ${name} group.`}
      />
    );
  return (
    <ChannelWelcome
      align="center"
      mark={<DmFace person={other} size="xl" />}
      title={other.username}
      line={`This is the beginning of your direct message history with ${other.username}.`}
      actions={dm.read_only ? undefined : <WaveButton dmId={dm.id} name={other.username} />}
    />
  );
}

function WaveButton({ dmId, name }: { dmId: string; name: string }) {
  const empty = useSpacesStore((state) => !state.messagesBySpace[dmId]?.length);
  const [sending, setSending] = useState(false);
  if (!empty) return null;
  const wave = () => {
    setSending(true);
    void useSpacesStore
      .getState()
      .sendMessage(dmId, "👋")
      .catch(() => undefined)
      .finally(() => setSending(false));
  };
  return (
    <Button icon={Hand} disabled={sending} onClick={wave}>
      {`Wave to ${name}`}
    </Button>
  );
}

function SharedSection<T>({
  title,
  resource,
  children,
}: {
  title: string;
  resource: CachedResource<T[]>;
  children: (items: T[]) => ReactNode;
}) {
  const items = resource.data;
  return (
    <PersonProfileSection title={title}>
      {resource.error && !items ? (
        <ErrorState
          inline
          title={`${title} couldn't load`}
          line="Check your connection and try again."
          action={{
            label: "Try again",
            variant: "secondary",
            onClick: () => void resource.reload({ force: true }),
          }}
        />
      ) : !items ? (
        <SkeletonList label={title} rows={2} leading="avatar" />
      ) : items.length ? (
        children(items)
      ) : (
        <Text size="control" tone="muted">
          None yet
        </Text>
      )}
    </PersonProfileSection>
  );
}

function SharedSpaceRow({ space }: { space: SharedSpace }) {
  const navigate = useNavigate();
  return (
    <NavRow onClick={() => navigate(spaceChatPath(space.id))}>
      <SpaceAvatar
        space={space}
        className="size-6 rounded-md"
        fallbackClassName="text-micro font-semibold"
      />
      <OverflowFadeText className="flex-1">{space.name}</OverflowFadeText>
    </NavRow>
  );
}

function MutualFriend({ person, onOpen }: { person: Person; onOpen: (userId: string) => void }) {
  const presence = usePresence(person.user_id);
  const custom = useCustomStatus(person.user_id);
  const picture = useMemberPicture(person.user_id, person.avatar_version);
  return (
    <MemberRow
      avatar={
        <ChatAvatar
          id={person.user_id}
          name={person.username}
          src={picture ?? undefined}
          size="sm"
          outline={avatarOutline(person.avatar_decoration)}
        />
      }
      name={person.username}
      presence={presence}
      line={custom || undefined}
      onOpen={() => onOpen(person.user_id)}
    />
  );
}

export function DmProfile({
  person,
  now,
  actions,
  onRemove,
  onBlock,
}: {
  person: Person;
  now?: ReactNode;
  actions?: ReactNode;
  onRemove: () => void;
  onBlock: () => void;
}) {
  const custom = useCustomStatus(person.user_id);
  const friends = useFriends();
  const friend = friends.data?.friends.find((item) => item.user_id === person.user_id);
  const since = friend?.since ? new Date(friend.since) : undefined;
  const banner = usePersonBanner(
    person.user_id,
    friend?.banner_version ?? person.banner_version ?? 0,
  );
  const spaces = useSharedSpaces(person.user_id);
  const mutual = useMutualFriends(person.user_id);
  const openDm = useOpenDm();
  return (
    <PersonProfile
      label="Profile"
      banner={banner}
      face={<DmFace person={person} size="xl" />}
      name={person.username}
      line={custom || undefined}
      actions={actions}
      menu={
        friend ? (
          <>
            <MenuItem icon={Trash2} label="Remove friend" danger onSelect={onRemove} />
            <MenuItem icon={Ban} label="Block" danger onSelect={onBlock} />
          </>
        ) : undefined
      }
    >
      {now ? <PersonProfileSection title="Now">{now}</PersonProfileSection> : null}
      {since && !Number.isNaN(since.getTime()) ? (
        <PersonProfileSection title="Friends since">
          <Text size="control">{longDate.format(since)}</Text>
        </PersonProfileSection>
      ) : null}
      <SharedSection title="Spaces in common" resource={spaces}>
        {(items) => (
          <NavList>
            {items.map((space) => (
              <SharedSpaceRow key={space.id} space={space} />
            ))}
          </NavList>
        )}
      </SharedSection>
      <SharedSection title="Mutual friends" resource={mutual}>
        {(items) => (
          <div className="flex flex-col">
            {items.map((item) => (
              <MutualFriend key={item.user_id} person={item} onOpen={(id) => void openDm(id)} />
            ))}
          </div>
        )}
      </SharedSection>
    </PersonProfile>
  );
}
