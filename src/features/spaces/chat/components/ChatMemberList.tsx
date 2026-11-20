// Who is in a Space, grouped as Space chat groups them: whose agents are at work, the hoisted
// roles, online, offline. Drawn with @misty/ui's MemberList.
import { Fragment, useMemo } from "react";
import { MemberGroupHeading, MemberList, MemberRow, type MemberPresence } from "@misty/ui";
import { useMistyStore, useStudioAgents } from "@/features/agents";
import { useNow } from "@/shared/hooks/useNow";
import type { Space, SpaceMember, SpaceRoleDef } from "../../api/dto/entities";
import { MemberRolesMenu } from "../../roles/MemberRolesMenu";
import { useSpacesStore } from "../../list/useSpacesStore";
import { doingLabel, memberAgentsIn, useMemberAgents } from "../../list/memberAgents";
import { spaceAgentStatuses } from "../../list/SpaceAgentsBroadcast";
import { memberColor, memberRoles, useSpaceRoles } from "../../roles/useSpaceRoles";
import { useMemberPicture } from "../../members/memberPictures";
import { ChatAvatar } from "./ChatAvatar";

interface Row {
  member: SpaceMember;
  presence: MemberPresence;
  line: string;
}

function agentLine(agent: { name: string; state: string; doing: string; files?: string[] }) {
  const file = agent.files?.[0]?.split("/").pop();
  const doing = file ? `editing ${file}` : doingLabel(agent.doing, agent.state as never);
  return doing ? `${agent.name} · ${doing}` : agent.name;
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
  const viewers = useSpacesStore((state) => state.presenceBySpace[spaceId]);
  const heard = useMemberAgents((state) => state.bySpace[spaceId]);
  const roles = useSpaceRoles(spaceId);
  const { agents } = useStudioAgents();
  const conversations = useMistyStore((state) => state.conversations);
  const mine = useMemo(
    () => spaceAgentStatuses(agents, spaceId, conversations),
    [agents, spaceId, conversations],
  );
  const groups = useMemo(() => {
    const here = new Set((viewers ?? []).map((viewer) => viewer.user_id));
    if (props.currentUserId) here.add(props.currentUserId);
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
        // An agent waiting on its person shows as waiting; at work, as working; here, online.
        const presence: MemberPresence = agent
          ? agent.state === "needs-you"
            ? "waiting"
            : "working"
          : here.has(member.user_id)
            ? "online"
            : "offline";
        return { member, presence, line: agent?.line ?? "", working: Boolean(agent) };
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
  }, [heard, people, mine, now, props, roles, spaceId, viewers]);

  return (
    <MemberList label="Members">
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

/** One person, whose roles open from their row for someone who manages roles. */
function MemberItem(props: {
  space: Space;
  member: SpaceMember;
  presence: MemberPresence;
  line: string;
  color?: string;
  owner: boolean;
  isMe: boolean;
}) {
  const picture = useMemberPicture(
    props.space.id,
    props.member.user_id,
    props.member.avatar_version,
  );
  return (
    <MemberRolesMenu space={props.space} member={props.member}>
      <MemberRow
        avatar={
          <ChatAvatar
            id={props.member.user_id}
            name={props.member.name}
            src={picture ?? undefined}
            size="default"
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
