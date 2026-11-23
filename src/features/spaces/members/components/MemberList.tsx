import type { SpaceMember } from "../../api/dto/entities";
import type { SpaceAgent } from "@/features/agents";
import type { ItemVisibility } from "../../api/visibility";
import { SpaceAgentRow } from "../agents/SpaceAgentRow";
import { agentsByOwner } from "../agents/use_space_agent_members";
import type { MemberAction } from "./SpaceMembers";
import { useMemberPicture } from "../member_pictures";
import { useAccountPresence } from "@/shared/lib/account_presence";
import { ChatAvatar } from "../../chat/components/ChatAvatar";
import {
  EmptyState,
  MenuItem,
  MenuSeparator,
  PersonRow,
  PresenceFace,
  RowGroupSection,
  SkeletonList,
} from "@misty/ui";
import { ShieldCheck, Trash2 } from "lucide-react";
import { Fragment } from "react";

const roleNames: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

function roleLine(member: SpaceMember, me: boolean) {
  const role = roleNames[member.role] ?? member.role;
  return me ? `${role}, you` : role;
}

function MemberFace({ member, me }: { member: SpaceMember; me: boolean }) {
  const picture = useMemberPicture(member.space_id, member.user_id, member.avatar_version);
  const account = useAccountPresence((state) => state.byUser[member.user_id]);
  return (
    <PresenceFace presence={account ?? (me ? "online" : "offline")}>
      <ChatAvatar id={member.user_id} name={member.name} src={picture ?? undefined} />
    </PresenceFace>
  );
}

export function MemberList({
  members,
  agents,
  loading,
  expectedCount,
  owner,
  canTransferOwnership,
  currentUserId,
  onAction,
  onRemoveAgent,
  onAgentVisibility,
}: {
  members: SpaceMember[];
  agents: SpaceAgent[] | undefined;
  loading: boolean;
  expectedCount?: number;
  owner: boolean;
  canTransferOwnership: boolean;
  currentUserId: string | undefined;
  onAction: (action: MemberAction) => void;
  onRemoveAgent: (agentId: string) => void;
  onAgentVisibility: (agentId: string, visibility: ItemVisibility) => void;
}) {
  const byOwner = agentsByOwner(agents);
  if (loading)
    return (
      <RowGroupSection title="Members">
        <SkeletonList
          label="Loading members"
          rows={Math.min(Math.max(expectedCount ?? 4, 1), 8)}
          leading="avatar"
          lines={2}
        />
      </RowGroupSection>
    );
  if (!members.length)
    return (
      <EmptyState
        inline
        title="No members loaded"
        line="Members will appear when access data is available."
      />
    );
  return (
    <RowGroupSection title="Members" count={members.length}>
      {members.map((member) => {
        const me = member.user_id === currentUserId;
        return (
          <Fragment key={member.user_id}>
            <PersonRow
              face={<MemberFace member={member} me={me} />}
              name={member.name}
              owner={member.role === "owner"}
              line={roleLine(member, me)}
              menu={
                owner && member.role !== "owner" ? (
                  <MemberActions
                    member={member}
                    canTransferOwnership={canTransferOwnership}
                    onAction={onAction}
                  />
                ) : undefined
              }
            />
            {(byOwner.get(member.user_id) ?? []).map((agent) => (
              <SpaceAgentRow
                key={agent.agent_id}
                agent={agent}
                onRemove={agent.can_edit ? () => onRemoveAgent(agent.agent_id) : undefined}
                onVisibilityChange={
                  agent.owner_user_id === currentUserId
                    ? (visibility) => onAgentVisibility(agent.agent_id, visibility)
                    : undefined
                }
              />
            ))}
          </Fragment>
        );
      })}
    </RowGroupSection>
  );
}

function MemberActions({
  member,
  canTransferOwnership,
  onAction,
}: {
  member: SpaceMember;
  canTransferOwnership: boolean;
  onAction: (action: MemberAction) => void;
}) {
  return (
    <>
      {canTransferOwnership ? (
        <>
          <MenuItem
            icon={<ShieldCheck />}
            label="Transfer ownership"
            onSelect={() => onAction({ kind: "transfer", member })}
          />
          <MenuSeparator />
        </>
      ) : null}
      <MenuItem
        icon={<Trash2 />}
        label="Remove member"
        danger
        onSelect={() => onAction({ kind: "remove", member })}
      />
    </>
  );
}
