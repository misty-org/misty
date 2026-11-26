import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ErrorState,
  MemberGroupHeading,
  MemberList,
  MemberRow,
  type MemberPresence,
} from "@misty/ui";
import { useMistyStore, useStudioAgents } from "@/features/agents";
import { useNow } from "@/shared/hooks/use_now";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import type { Space, SpaceMember, SpaceRoleDef } from "../../api/dto/entities";
import { MemberRolesMenu } from "../../roles/MemberRolesMenu";
import { loadSpaceMembers } from "../load_space_members";
import { useSpacesStore } from "../../list/use_spaces_store";
import { doingLabel, memberAgentsIn, useMemberAgents } from "../../list/member_agents";
import { spaceAgentStatuses } from "../../list/SpaceAgentsBroadcast";
import { memberColor, memberRoles, useSpaceRoles } from "../../roles/use_space_roles";
import { useMemberPicture } from "../../members/member_pictures";
import { useAccountPresence } from "@/shared/lib/account_presence";
import { useVoicePresence } from "../../list/voice_presence";
import { useSpaceConversations } from "../sidebar/use_space_conversations";
import { appEntry } from "../../apps/third_party_apps";
import { ChatAvatar } from "./ChatAvatar";

interface Row {
  member: SpaceMember;
  presence: MemberPresence;
  line: string;
}

function agentLine(agent: {
  name: string;
  state: string;
  doing: string;
  files?: string[];
  waiting?: number;
}) {
  const file = agent.files?.[0]?.split("/").pop();
  const doing = file
    ? `editing ${file}`
    : doingLabel(agent.doing, agent.state as never, agent.waiting);
  return doing ? `${agent.name} is ${doing.charAt(0).toLowerCase()}${doing.slice(1)}` : agent.name;
}

function topHoisted(member: SpaceMember, roles: SpaceRoleDef[] | undefined) {
  return memberRoles(member, roles).find((role) => role.hoist)?.id;
}

export function ChatMemberList(props: {
  space: Space;
  spaceId: string;
  ownerUserId: string;
  currentUserId?: string;
  visibleTo?: (member: SpaceMember) => boolean;
}) {
  const { spaceId } = props;
  const now = useNow();
  const people = useSpacesStore((state) => state.membersBySpace[spaceId]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (people) return;
    let active = true;
    setFailed(false);
    void loadSpaceMembers(spaceId).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [people, spaceId, attempt]);
  const viewers = useSpacesStore((state) => state.presenceBySpace[spaceId]);
  const accounts = useAccountPresence((state) => state.byUser);
  const voice = useVoicePresence((state) => state.bySpace[spaceId]);
  const inVoice = Object.values(voice ?? {}).some((people) => people.length > 0);
  const { conversations } = useSpaceConversations(inVoice ? spaceId : "");
  const heard = useMemberAgents((state) => state.bySpace[spaceId]);
  const roles = useSpaceRoles(spaceId);
  const { agents } = useStudioAgents();
  const agentChats = useMistyStore((state) => state.conversations);
  const mine = useMemo(
    () => spaceAgentStatuses(agents, spaceId, agentChats),
    [agents, spaceId, agentChats],
  );
  const groups = useMemo(() => {
    const here = new Set((viewers ?? []).map((viewer) => viewer.user_id));
    if (props.currentUserId) here.add(props.currentUserId);
    const activity = new Map<string, string>();
    for (const [channelId, people] of Object.entries(voice ?? {})) {
      const channel = conversations.find((conversation) => conversation.id === channelId);
      for (const userId of people) if (channel) activity.set(userId, `In ${channel.title}`);
    }
    for (const viewer of viewers ?? []) {
      if (activity.has(viewer.user_id)) continue;
      if (viewer.place === "app" && viewer.item_id) {
        const name = appEntry({ app_id: viewer.item_id })?.name ?? viewer.item_id;
        activity.set(viewer.user_id, `In ${name}`);
      } else if (viewer.place === "lab") activity.set(viewer.user_id, "In the Lab");
    }
    const working = new Map<string, { state: string; line: string }>();
    const remember = (userId: string, agent: Parameters<typeof agentLine>[0]) => {
      if (agent.state === "resting" || working.get(userId)?.state === "working") return;
      working.set(userId, { state: agent.state, line: agentLine(agent) });
    };
    for (const { userId, agent } of memberAgentsIn(
      { bySpace: { [spaceId]: heard ?? {} } },
      spaceId,
      now,
    ))
      remember(userId, agent);
    if (props.currentUserId) for (const agent of mine) remember(props.currentUserId, agent);
    const rows: (Row & { working: boolean })[] = (people ?? [])
      .filter((member) => !props.visibleTo || props.visibleTo(member))
      .map((member) => {
        const agent = working.get(member.user_id);
        const account = accounts[member.user_id];
        const presence: MemberPresence = agent
          ? agent.state === "needs-you"
            ? "waiting"
            : "working"
          : account
            ? account
            : here.has(member.user_id)
              ? "online"
              : "offline";
        const line =
          agent?.line ?? (presence === "offline" ? "" : (activity.get(member.user_id) ?? ""));
        return { member, presence, line, working: Boolean(agent) };
      })
      .sort((left, right) => left.member.name.localeCompare(right.member.name));
    const out: { title: string; rows: Row[] }[] = [];
    const take = (
      title: string,
      pick: (item: (typeof rows)[number]) => boolean,
      pool: typeof rows,
    ) => {
      const picked = pool.filter(pick);
      if (picked.length) out.push({ title, rows: picked });
      return pool.filter((item) => !picked.includes(item));
    };
    let rest = take("Working", (item) => item.working, rows);
    for (const role of (roles ?? []).filter((item) => item.hoist && !item.is_default))
      rest = take(
        role.name,
        (item) => item.presence !== "offline" && topHoisted(item.member, roles) === role.id,
        rest,
      );
    rest = take("Online", (item) => item.presence !== "offline", rest);
    take("Offline", () => true, rest);
    return out;
  }, [heard, people, mine, now, props, roles, spaceId, viewers, accounts, voice, conversations]);

  if (!people && failed)
    return (
      <MemberList label="Members">
        <ErrorState
          inline
          title="Members couldn’t load"
          action={{
            label: "Try again",
            variant: "secondary",
            onClick: () => setAttempt((count) => count + 1),
          }}
        />
      </MemberList>
    );
  return (
    <MemberList label="Members" loading={!people}>
      {groups.map((group) => (
        <Fragment key={group.title}>
          <MemberGroupHeading title={group.title} count={group.rows.length} />
          {group.rows.map((item) => (
            <MemberItem
              key={item.member.user_id}
              space={props.space}
              member={item.member}
              presence={item.presence}
              line={item.line}
              color={memberColor(item.member, roles)}
              owner={item.member.user_id === props.ownerUserId}
              isMe={item.member.user_id === props.currentUserId}
            />
          ))}
        </Fragment>
      ))}
    </MemberList>
  );
}

function MemberItem(props: {
  space: Space;
  member: SpaceMember;
  presence: MemberPresence;
  line: string;
  color?: string;
  owner: boolean;
  isMe: boolean;
}) {
  const picture = useMemberPicture(props.member.user_id, props.member.avatar_version);
  return (
    <MemberRolesMenu space={props.space} member={props.member}>
      <MemberRow
        avatar={
          <ChatAvatar
            id={props.member.user_id}
            name={props.member.name}
            src={picture ?? undefined}
            size="default"
            outline={avatarOutline(props.member.avatar_decoration)}
          />
        }
        name={props.member.name}
        color={props.color}
        owner={props.owner}
        presence={props.presence === "offline" && props.isMe ? "online" : props.presence}
        line={props.line || undefined}
      />
    </MemberRolesMenu>
  );
}
