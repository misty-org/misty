import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ErrorState,
  MemberGroupHeading,
  MemberList,
  MemberRow,
  type MemberPresence,
} from "@misty/ui";
import { useMistyStore, usePersonalAgentsStore, useStudioAgents } from "@/features/agents";
import { useNow } from "@/shared/hooks/use_now";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import type { Space, SpaceMember, SpaceRoleDef } from "../../api/dto/entities";
import { MemberRolesMenu } from "../../roles/MemberRolesMenu";
import { loadSpaceMembers } from "../load_space_members";
import { useSpacesStore } from "../../list/use_spaces_store";
import {
  doingLabel,
  memberAgentsIn,
  useMemberAgents,
  type MemberAgentStatus,
} from "../../list/member_agents";
import { spaceAgentStatuses } from "../../list/SpaceAgentsBroadcast";
import { memberColor, memberRoles, useSpaceRoles } from "../../roles/use_space_roles";
import { useMemberPicture } from "../../members/member_pictures";
import { useAccountPresence } from "@/shared/lib/account_presence";
import { useVoicePresence } from "../../list/voice_presence";
import { useSpaceConversations } from "../sidebar/use_space_conversations";
import { appEntry } from "../../apps/third_party_apps";
import { ChatAgentAvatar, ChatAvatar } from "./ChatAvatar";

interface RowBase {
  key: string;
  name: string;
  presence: MemberPresence;
  line: string;
}

type Row =
  | (RowBase & { kind: "person"; member: SpaceMember })
  | (RowBase & { kind: "agent"; agentId: string });

const busy: Record<MemberAgentStatus["state"], number> = {
  working: 3,
  "needs-you": 2,
  landing: 1,
  resting: 0,
};

function agentLine(agent: MemberAgentStatus) {
  const file = agent.files?.[0]?.split("/").pop();
  return file ? `Editing ${file}` : doingLabel(agent.doing, agent.state, agent.waiting);
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
  const profiles = usePersonalAgentsStore((state) => state.agents);
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
    const status = new Map<string, MemberAgentStatus>();
    const remember = (agent: MemberAgentStatus) => {
      const known = status.get(agent.id);
      if (!known || busy[agent.state] > busy[known.state]) status.set(agent.id, agent);
    };
    for (const { agent } of memberAgentsIn({ bySpace: { [spaceId]: heard ?? {} } }, spaceId, now))
      remember(agent);
    for (const agent of mine) remember(agent);
    const spaceAgents = new Map<string, string>();
    for (const agent of profiles)
      if (agent.space_id === spaceId && agent.enabled && !agent.system_managed)
        spaceAgents.set(agent.id, agent.name);
    const personRows: Row[] = (people ?? [])
      .filter((member) => !props.visibleTo || props.visibleTo(member))
      .map((member) => {
        const account = accounts[member.user_id];
        const presence: MemberPresence = account
          ? account
          : here.has(member.user_id)
            ? "online"
            : "offline";
        const line = presence === "offline" ? "" : (activity.get(member.user_id) ?? "");
        const key = member.user_id;
        return { kind: "person" as const, key, name: member.name, member, presence, line };
      });
    const agentRows: Row[] = [...spaceAgents].map(([agentId, name]) => {
      const agent = status.get(agentId);
      const state = agent?.state ?? "resting";
      const presence: MemberPresence =
        state === "needs-you" ? "waiting" : state === "resting" ? "online" : "working";
      return {
        kind: "agent" as const,
        key: `agent:${agentId}`,
        name,
        agentId,
        presence,
        line: agent ? agentLine(agent) : "",
      };
    });
    const rows = [...personRows, ...agentRows].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
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
    let rest = rows;
    for (const role of (roles ?? []).filter((item) => item.hoist && !item.is_default))
      rest = take(
        role.name,
        (item) =>
          item.kind === "person" &&
          item.presence !== "offline" &&
          topHoisted(item.member, roles) === role.id,
        rest,
      );
    rest = take("Online", (item) => item.presence !== "offline", rest);
    take("Offline", () => true, rest);
    return out;
  }, [
    heard,
    people,
    mine,
    profiles,
    now,
    props,
    roles,
    spaceId,
    viewers,
    accounts,
    voice,
    conversations,
  ]);

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
          {group.rows.map((item) =>
            item.kind === "agent" ? (
              <MemberRow
                key={item.key}
                avatar={<ChatAgentAvatar agentId={item.agentId} name={item.name} />}
                name={item.name}
                presence={item.presence}
                line={item.line || undefined}
              />
            ) : (
              <MemberItem
                key={item.key}
                space={props.space}
                member={item.member}
                presence={item.presence}
                line={item.line}
                color={memberColor(item.member, roles)}
                owner={item.member.user_id === props.ownerUserId}
                isMe={item.member.user_id === props.currentUserId}
              />
            ),
          )}
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
