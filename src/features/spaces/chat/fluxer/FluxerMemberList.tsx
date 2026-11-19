// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): features/channel/components/
// ChannelMembers.tsx, MemberListContainer.tsx, MemberListItem.tsx and MemberListGroupHeader.tsx,
// grouped as Misty's Space chat groups people: whose agents are at work, roles shown on their own,
// online, offline.
import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Crown } from "lucide-react";
import { spacesGateway, useMistyStore, useStudioAgents } from "@/features/agents";
import { useNow } from "@/shared/hooks/useNow";
import type { Space, SpaceMember, SpaceRoleDef } from "../../api/dto/entities";
import { MemberRolesMenu } from "../../roles/MemberRolesMenu";
import { useSpacesStore } from "../../list/useSpacesStore";
import { doingLabel, memberAgentsIn, useMemberAgents } from "../../list/memberAgents";
import { spaceAgentStatuses } from "../../list/SpaceAgentsBroadcast";
import { memberColor, memberRoles, useSpaceRoles } from "../../roles/useSpaceRoles";
import { FluxerScroller } from "./FluxerScroller";
import { FluxerAvatar, type FluxerPresence } from "./FluxerAvatar";
import { FluxerTooltip } from "./FluxerTooltip";
import { cx } from "./cx";
import container from "./css/MemberListContainer.module.css";
import members from "./css/ChannelMembers.module.css";
import row from "./css/MemberListItem.module.css";

/** MemberListMetrics: a 44px slot per person, a 32px group header. */
const ITEM_HEIGHT = 44;
const GROUP_HEIGHT = 32;

interface Row {
  member: SpaceMember;
  presence: FluxerPresence;
  line: string;
}

/** A member's picture, through the Spaces gateway; none until it answers. */
export function useMemberPicture(spaceId: string, userId: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(undefined);
    const gateway = spacesGateway.maybe();
    if (!gateway || !userId) return;
    let live = true;
    void gateway.memberPicture(spaceId, userId).then((found) => live && setUrl(found ?? undefined));
    return () => {
      live = false;
    };
  }, [spaceId, userId]);
  return url;
}

function agentLine(agent: { name: string; state: string; doing: string; files?: string[] }) {
  const file = agent.files?.[0]?.split("/").pop();
  const doing = file ? `editing ${file}` : doingLabel(agent.doing, agent.state as never);
  return doing ? `${agent.name} · ${doing}` : agent.name;
}

function topHoisted(member: SpaceMember, roles: SpaceRoleDef[] | undefined) {
  return memberRoles(member, roles).find((role) => role.hoist)?.id;
}

export function FluxerMemberList(props: {
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
        // An agent waiting on its person shows as idle; at work, or simply here, as online.
        const presence: FluxerPresence = agent
          ? agent.state === "needs-you"
            ? "idle"
            : "online"
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

  // ChannelMembers lays the list out as absolutely placed rows, headers 32px, people 44px.
  let y = 0;
  const placed: { key: string; node: ReactNode }[] = [];
  const numbers = new Intl.NumberFormat();
  for (const group of groups) {
    placed.push({
      key: `group:${group.title}`,
      node: (
        <div
          className={cx(members.virtualRow, members.virtualGroupRow)}
          role="heading"
          aria-level={3}
          style={{ transform: `translateY(${y}px)` }}
        >
          <span className={members.groupHeaderLabel}>{group.title}</span>
          <span className={members.groupHeaderSeparator}>—</span>
          <span className={members.groupHeaderCount}>{numbers.format(group.rows.length)}</span>
        </div>
      ),
    });
    y += GROUP_HEIGHT;
    for (const item of group.rows) {
      placed.push({
        key: `${group.title}:${item.member.user_id}`,
        node: (
          <div
            className={cx(members.virtualRow, members.virtualMemberRow)}
            style={{ transform: `translateY(${y}px)` }}
          >
            <MemberListItem
              space={props.space}
              member={item.member}
              presence={item.presence}
              line={item.line}
              color={memberColor(item.member, roles)}
              owner={item.member.user_id === props.ownerUserId}
              isMe={item.member.user_id === props.currentUserId}
            />
          </div>
        ),
      });
      y += ITEM_HEIGHT;
    }
  }
  return (
    <aside aria-label="Members" className={container.memberListContainer}>
      <FluxerScroller className={container.memberListScroller}>
        <div
          className={members.virtualListContent}
          style={
            {
              "--member-list-item-height": `${ITEM_HEIGHT}px`,
              "--member-list-group-header-height": `${GROUP_HEIGHT}px`,
              height: y,
            } as CSSProperties
          }
        >
          {placed.map((entry) => (
            <Fragment key={entry.key}>{entry.node}</Fragment>
          ))}
        </div>
      </FluxerScroller>
    </aside>
  );
}

/** MemberListItem: face with presence, name in the role's color, the owner's crown, a sub-line. */
function MemberListItem(props: {
  space: Space;
  member: SpaceMember;
  presence: FluxerPresence;
  line: string;
  color?: string;
  owner: boolean;
  isMe: boolean;
}) {
  const picture = useMemberPicture(props.space.id, props.member.user_id);
  const offline = props.presence === "offline" && !props.isMe;
  return (
    <MemberRolesMenu space={props.space} member={props.member}>
      <button
        type="button"
        className={cx(row.button, offline && row.buttonOffline)}
        data-member-list-focus-item
      >
        <div className={row.grid}>
          <span className={row.content}>
            <div className={row.avatarContainer}>
              <FluxerAvatar
                id={props.member.user_id}
                name={props.member.name}
                size={32}
                src={picture}
                status={offline ? undefined : props.presence}
              />
            </div>
            <div className={row.userInfoContainer}>
              <div className={row.nameContainer}>
                <span
                  className={cx(row.name, props.color && row.nameRoleColored)}
                  style={
                    props.color
                      ? ({ "--member-role-color": props.color } as CSSProperties)
                      : undefined
                  }
                >
                  {props.member.name}
                </span>
                {props.owner ? (
                  <div className={row.ownerIcon}>
                    <FluxerTooltip content="Space owner">
                      <span>
                        <Crown className={row.crownIcon} />
                      </span>
                    </FluxerTooltip>
                  </div>
                ) : null}
              </div>
              {props.line ? <div className={row.memberCustomStatus}>{props.line}</div> : null}
            </div>
          </span>
        </div>
      </button>
    </MemberRolesMenu>
  );
}
