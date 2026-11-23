import type { SpaceMember } from "../../api/dto/entities";

export type MemberAction = { kind: "transfer" | "remove"; member: SpaceMember };

import { SystemErrorNotice } from "@/shared/platform/system_errors";
import { useAuth } from "@/features/account";
import { Button, RowGroupStack, Surface } from "@misty/ui";
import { UserPlus } from "lucide-react";
import { BringAgentMenu } from "../agents/BringAgentMenu";
import { useSpaceAgentMembers } from "../agents/use_space_agent_members";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { MemberActionDialog } from "./MemberActionDialog";
import { MemberList } from "./MemberList";
import { PendingInvitationsCard } from "./PendingInvitationsCard";
import { SpaceBoosts } from "./SpaceBoosts";
import { useMemberDialogs } from "./use_member_dialogs";
import { useSpaceMembers } from "./use_space_members";

export function SpaceMembers({
  spaceId,
  embedded = false,
  invite = false,
}: {
  spaceId: string;
  embedded?: boolean;
  invite?: boolean;
}) {
  const { user } = useAuth();
  const state = useSpaceMembers(spaceId);
  const dialogs = useMemberDialogs(spaceId, state, invite);
  const { space, members, error } = state;
  const spaceAgents = useSpaceAgentMembers(spaceId);
  return (
    <Surface
      tone={embedded ? "none" : "page"}
      className={embedded ? "min-w-0" : "h-full min-h-0 overflow-auto px-5 py-5 sm:px-6"}
    >
      <RowGroupStack className={embedded ? "w-full" : "mx-auto w-full max-w-5xl"}>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <BringAgentMenu
            agents={spaceAgents.agents}
            currentUserId={user?.id}
            onBring={(agentId) => void spaceAgents.bring(agentId)}
          />
          {state.canInvite ? (
            <Button type="button" variant="primary" icon={UserPlus} onClick={dialogs.openInvite}>
              Invite people
            </Button>
          ) : null}
        </div>

        <SpaceBoosts spaceId={spaceId} />

        {error || spaceAgents.error ? (
          <SystemErrorNotice
            error={error || spaceAgents.error}
            scope={`spaces:members:${spaceId}`}
            title="Space membership needs attention"
          />
        ) : null}

        <MemberList
          members={members}
          agents={spaceAgents.agents}
          onRemoveAgent={(agentId) => void spaceAgents.remove(agentId)}
          onAgentVisibility={(agentId, visibility) =>
            void spaceAgents.setVisibility(agentId, visibility)
          }
          loading={state.membersLoading}
          expectedCount={state.space?.member_count}
          owner={state.canManageMembers}
          canTransferOwnership={state.canTransferOwnership}
          currentUserId={user?.id}
          onAction={dialogs.setMemberAction}
        />

        {state.canInvite ? (
          <PendingInvitationsCard
            spaceId={spaceId}
            invitations={state.pendingInvitations}
            onReloadInvitations={state.loadPendingInvitations}
            onReloadSpaces={state.load}
            onLink={dialogs.showInviteLink}
          />
        ) : null}
      </RowGroupStack>

      <InviteMemberDialog dialogs={dialogs} spaceName={space?.name ?? "Space"} />
      <MemberActionDialog dialogs={dialogs} />
    </Surface>
  );
}
