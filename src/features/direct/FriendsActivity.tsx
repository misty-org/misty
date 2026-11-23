import { useEffect, useMemo } from "react";
import { Moon, Volume2 } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  EmptyState,
  PresenceFace,
  RowGroupLabel,
  Surface,
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
  useSpacesStore,
  useVoicePresence,
  watchVoicePresence,
  type MemberAgentStatus,
  type Space,
} from "@/features/spaces";
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

export function Face({ userId, name, size }: { userId: string; name: string; size?: "xs" | "sm" }) {
  const presence = usePresence(userId);
  const avatar = (
    <Avatar size={size} tone={personTone(userId)}>
      <AvatarFallback>{personInitials(name)}</AvatarFallback>
    </Avatar>
  );
  return size === "xs" ? (
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

function VoiceBlock({ spot, nameOf }: { spot: VoiceSpot; nameOf: (userId: string) => string }) {
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
          avatar={<Face userId={person} name={nameOf(person)} size="xs" />}
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

export function ActiveNow({
  friends,
  activities,
}: {
  friends: Person[];
  activities: Map<string, Activity>;
}) {
  const members = useSpacesStore((state) => state.membersBySpace);
  const nameOf = (userId: string) =>
    friends.find((friend) => friend.user_id === userId)?.username ??
    Object.values(members)
      .flat()
      .find((member) => member.user_id === userId)?.name ??
    "Someone";
  const active = friends.filter((friend) => activities.has(friend.user_id));
  return (
    <div className="flex size-full flex-col overflow-y-auto px-3 pt-4 pb-6">
      {active.length ? (
        <section aria-label="Active now" className="grid min-w-0 gap-1.5">
          <RowGroupLabel title="Active now" />
          <div className="grid min-w-0 gap-2">
            {active.map((friend) => {
              const activity = activities.get(friend.user_id)!;
              const where = activity.voice?.space ?? activity.agents[0]?.space;
              return (
                <Surface
                  key={friend.user_id}
                  as="section"
                  tone="faint"
                  radius="xl"
                  aria-label={friend.username}
                  className="grid min-w-0 gap-2 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Face userId={friend.user_id} name={friend.username} />
                    <span className="grid min-w-0">
                      <Text size="control" weight="medium" tone="bright">
                        {friend.username}
                      </Text>
                      {where ? (
                        <Text size="meta" tone="muted">
                          {`In ${where.name}`}
                        </Text>
                      ) : null}
                    </span>
                  </div>
                  {activity.voice ? (
                    <Surface tone="faint" radius="lg" className="grid min-w-0 gap-2 p-2">
                      <VoiceBlock spot={activity.voice} nameOf={nameOf} />
                    </Surface>
                  ) : null}
                  {activity.agents.map((spot) => (
                    <Surface
                      key={`${spot.space.id}:${spot.agent.id}`}
                      tone="faint"
                      radius="lg"
                      className="grid min-w-0 gap-2 p-2"
                    >
                      <AgentLine spot={spot} />
                    </Surface>
                  ))}
                </Surface>
              );
            })}
          </div>
        </section>
      ) : (
        <EmptyState icon={Moon} line="Nobody's active right now" />
      )}
    </div>
  );
}
