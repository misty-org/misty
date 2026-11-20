import type { SpaceMember } from "../../api/dto/entities";

export type MemberAction = { kind: "transfer" | "remove"; member: SpaceMember };

import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import { useAuth } from "@/features/account";
import { Button, Skeleton, Surface, Text } from "@misty/ui";
import { UserPlus } from "lucide-react";
import { BringAgentMenu } from "../agents/BringAgentMenu";
import { useSpaceAgentMembers } from "../agents/useSpaceAgentMembers";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { MemberActionDialog } from "./MemberActionDialog";
import { MemberList } from "./MemberList";
import { PendingInvitationsCard } from "./PendingInvitationsCard";
import { SpaceBoosts } from "./SpaceBoosts";
import { useMemberDialogs } from "./useMemberDialogs";
import { useSpaceMembers } from "./useSpaceMembers";

export function SpaceMembers({
  spaceId,
  embedded = false,
  invite = false,
}: {
  spaceId: string;
  embedded?: boolean;
  /** Opens the invite dialog straight away (People's Invite). */
  invite?: boolean;
}) {
  const { user } = useAuth();
  const state = useSpaceMembers(spaceId);
  const dialogs = useMemberDialogs(spaceId, state, invite);
  const { space, members, error } = state;
  const spaceAgents = useSpaceAgentMembers(spaceId);
  // The count is said only once the list has been read, never "0" before it arrives.
  const membersRead = Boolean(state.membersBySpace[spaceId]);
  const counts = [
    membersRead ? `${members.length} active member${members.length === 1 ? "" : "s"}` : "",
    space?.pending_count ? `${space.pending_count} pending` : "",
  ].filter(Boolean);

  return (
    <Surface
      tone={embedded ? "none" : "page"}
      className={embedded ? "min-w-0" : "h-full min-h-0 overflow-auto px-5 py-5 sm:px-6"}
    >
      <div className={embedded ? "w-full" : "mx-auto w-full max-w-5xl"}>
        <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
          <div>
            {!embedded ? (
              <Text as="h2" tone="default" className="m-0 text-sm font-semibold">
                Members
              </Text>
            ) : null}
            {state.membersLoading ? (
              <div className={`${embedded ? "" : "mt-1"} flex h-4 items-center`} aria-hidden="true">
                <Skeleton className="h-3 w-28" />
              </div>
            ) : counts.length ? (
              <Text as="p" tone="muted" className={`${embedded ? "m-0" : "mb-0 mt-1"} text-xs`}>
                {counts.join(" · ")}
              </Text>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <BringAgentMenu
              agents={spaceAgents.agents}
              currentUserId={user?.id}
              onBring={(agentId) => void spaceAgents.bring(agentId)}
            />
            {state.canInvite ? (
              <Button type="button" onClick={dialogs.openInvite}>
                <UserPlus /> Invite member
              </Button>
            ) : null}
          </div>
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
      </div>

      <InviteMemberDialog dialogs={dialogs} spaceName={space?.name ?? "Space"} />
      <MemberActionDialog dialogs={dialogs} />
    </Surface>
  );
}
