import { useEffect, useMemo } from "react";
import { Volume2 } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  PresenceFace,
  StateMark,
  Text,
  VoicePerson,
  useNow,
} from "@misty/ui";
import {
  doingLabel,
  memberAgentsIn,
  useMemberAgents,
  useSpaceConversations,
  useMemberPicture,
  useSpacesStore,
  useVoicePresence,
  watchVoicePresence,
  type MemberAgentStatus,
  type Space,
} from "@/features/spaces";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { personTone } from "@/shared/lib/person_tone";
import { personInitials } from "@/shared/lib/person_initials";
import type { Person } from "./api";
import { useDirectUserId } from "./direct_account";
import { useCallStore } from "./calls/call_store";
import { joinVoiceChannel } from "./calls/voice_channels";
import { usePresence } from "./status_store";

interface VoiceSpot {
  space: Space;
  channelId: string;
  people: string[];
}

interface AgentSpot {
  space: Space;
  agent: MemberAgentStatus;
}

export interface Activity {
  voice?: VoiceSpot;
  agents: AgentSpot[];
}

type FaceData = { avatar_version?: number; avatar_decoration?: unknown };

export function Face({
  userId,
  name,
  size,
  person,
  bare = false,
}: {
  userId: string;
  name: string;
  size?: "xs" | "sm";
  person?: FaceData;
  bare?: boolean;
}) {
  const presence = usePresence(userId);
  const picture = useMemberPicture(userId, person?.avatar_version ?? 0);
  const avatar = (
    <Avatar
      size={size}
      tone={personTone(userId)}
      outline={avatarOutline(person?.avatar_decoration)}
    >
      {picture ? <AvatarImage src={picture} alt="" /> : null}
      <AvatarFallback>{personInitials(name)}</AvatarFallback>
    </Avatar>
  );
  return size === "xs" || bare ? (
    avatar
  ) : (
    <PresenceFace presence={presence} face={size ?? "default"}>
      {avatar}
    </PresenceFace>
  );
}

function useSharedSpaces(): Space[] {
  const spaces = useSpacesStore((state) => state.spaces);
  return useMemo(() => spaces.filter((space) => space.is_shared && !space.is_default), [spaces]);
}

export function useActivities(friends: Person[]): Map<string, Activity> {
  const shared = useSharedSpaces();
  const members = useSpacesStore((state) => state.membersBySpace);
  const voice = useVoicePresence((state) => state.bySpace);
  const agents = useMemberAgents((state) => state.bySpace);
  const now = useNow();
  useEffect(() => {
    const { loadMembers, membersBySpace } = useSpacesStore.getState();
    for (const space of shared) if (!membersBySpace[space.id]) void loadMembers(space.id);
    const stops = shared.map((space) => watchVoicePresence(space.id));
    return () => stops.forEach((stop) => stop());
  }, [shared]);
  return useMemo(() => {
    const byFriend = new Map<string, Activity>();
    const ids = new Set(friends.map((friend) => friend.user_id));
    for (const space of shared) {
      const inSpace = new Set((members[space.id] ?? []).map((member) => member.user_id));
      for (const [channelId, people] of Object.entries(voice[space.id] ?? {}))
        for (const userId of people)
          if (ids.has(userId) && inSpace.has(userId)) {
            const activity = byFriend.get(userId) ?? { agents: [] };
            activity.voice ??= { space, channelId, people };
            byFriend.set(userId, activity);
          }
      for (const { userId, agent } of memberAgentsIn({ bySpace: agents }, space.id, now))
        if (ids.has(userId) && inSpace.has(userId) && agent.state !== "resting") {
          const activity = byFriend.get(userId) ?? { agents: [] };
          activity.agents.push({ space, agent });
          byFriend.set(userId, activity);
        }
    }
    return byFriend;
  }, [friends, shared, members, voice, agents, now]);
}

export function activityLine(activity: Activity | undefined): string | undefined {
  if (activity?.voice) return `In a voice channel in ${activity.voice.space.name}`;
  const working = activity?.agents[0];
  if (!working) return undefined;
  const doing = doingLabel(working.agent.doing, working.agent.state);
  return `${working.agent.name}: ${doing.toLowerCase()} in ${working.space.name}`;
}

function VoiceBlock({
  spot,
  nameOf,
  faceOf,
}: {
  spot: VoiceSpot;
  nameOf: (userId: string) => string;
  faceOf: (userId: string) => FaceData | undefined;
}) {
  const { conversations } = useSpaceConversations(spot.space.id);
  const userId = useDirectUserId();
  const speaking = useCallStore((state) => state.speaking);
  const name = conversations.find((item) => item.id === spot.channelId)?.title ?? "Voice channel";
  return (
    <div className="grid gap-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <Volume2 aria-hidden="true" className="shrink-0" />
        <Text size="meta">{name}</Text>
      </div>
      {spot.people.map((person) => (
        <VoicePerson
          key={person}
          name={nameOf(person)}
          speaking={speaking.includes(person)}
          avatar={<Face userId={person} name={nameOf(person)} size="xs" person={faceOf(person)} />}
          className="pl-0"
        />
      ))}
      {userId ? (
        <div className="pt-1.5">
          <Button
            size="sm"
            onClick={() =>
              void joinVoiceChannel(
                { spaceId: spot.space.id, channelId: spot.channelId, name },
                userId,
              )
            }
          >
            Join
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AgentLine({ spot }: { spot: AgentSpot }) {
  const waiting = spot.agent.state === "needs-you";
  return (
    <div className="grid gap-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <StateMark kind={waiting ? "waiting" : "working"} label={waiting ? "Waiting" : "Working"} />
        <Text size="meta">{spot.agent.name}</Text>
        <Text size="meta" tone="muted" className="min-w-0 flex-1">
          {doingLabel(spot.agent.doing, spot.agent.state)}
        </Text>
      </div>
      {(spot.agent.files ?? []).slice(0, 3).map((file) => (
        <Text key={file} size="meta" tone="muted" className="pl-7">
          {file}
        </Text>
      ))}
    </div>
  );
}

export function FriendNow({ friends, activity }: { friends: Person[]; activity: Activity }) {
  const members = useSpacesStore((state) => state.membersBySpace);
  const nameOf = (userId: string) =>
    friends.find((friend) => friend.user_id === userId)?.username ??
    Object.values(members)
      .flat()
      .find((member) => member.user_id === userId)?.name ??
    "Someone";
  const faceOf = (userId: string) =>
    friends.find((friend) => friend.user_id === userId) ??
    Object.values(members)
      .flat()
      .find((member) => member.user_id === userId);
  return (
    <div className="grid min-w-0 gap-3">
      {activity.voice ? <VoiceBlock spot={activity.voice} nameOf={nameOf} faceOf={faceOf} /> : null}
      {activity.agents.map((spot) => (
        <AgentLine key={`${spot.space.id}:${spot.agent.id}`} spot={spot} />
      ))}
    </div>
  );
}
