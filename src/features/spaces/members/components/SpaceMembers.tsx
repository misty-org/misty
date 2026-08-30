export type { MemberAction } from "@/api/spaces/dto/types/components/SpaceMembers";

import { agentTeammatesV1Enabled } from "@/features/agents";
import { SystemErrorActivity } from "@/features/activity";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { Button } from "@/shared/ui";
import { UserPlus } from "lucide-react";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { MemberActionDialog } from "./MemberActionDialog";
import { MemberList } from "./MemberList";
import { PendingInvitationsCard } from "./PendingInvitationsCard";
import { TeamList } from "./TeamList";
import { useMemberDialogs } from "./useMemberDialogs";
import { useSpaceMembers } from "./useSpaceMembers";

export function SpaceMembers({
  spaceId,
  embedded = false,
}: {
  spaceId: string;
  embedded?: boolean;
}) {
  const { user } = useAuth();
  const state = useSpaceMembers(spaceId);
  const dialogs = useMemberDialogs(spaceId, state);
  const { space, members, agents, error } = state;
  const teammatesEnabled = agentTeammatesV1Enabled();

  return (
    <div
      className={
        embedded ? "min-w-0" : "h-full min-h-0 overflow-auto bg-charcoal-bg px-5 py-5 sm:px-6"
      }
    >
      <div className={embedded ? "w-full" : "mx-auto w-full max-w-5xl"}>
        <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div>
            {!embedded ? (
              <h2 className="m-0 text-sm font-semibold text-cream">
                {teammatesEnabled ? "Team" : "Members"}
              </h2>
            ) : null}
            <p className={`${embedded ? "m-0" : "mb-0 mt-1"} text-xs text-cream-muted`}>
              {teammatesEnabled
                ? `${members.length + agents.length + 1} teammates`
                : `${members.length} active member${members.length === 1 ? "" : "s"}`}
              {space?.pending_count ? ` · ${space.pending_count} pending` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {state.canInvite ? (
              <Button type="button" onClick={dialogs.openInvite}>
                <UserPlus className="size-4" /> Invite member
              </Button>
            ) : null}
          </div>
        </div>

        {error ? (
          <SystemErrorActivity
            error={error}
            scope={`spaces:members:${spaceId}`}
            title="Space membership needs attention"
            target={{ kind: "route", href: `/spaces/${encodeURIComponent(spaceId)}` }}
          />
        ) : null}

        {teammatesEnabled ? (
          <TeamList
            spaceId={spaceId}
            members={members}
            agents={agents}
            loading={state.membersLoading}
            owner={state.canManageMembers}
            canManageAgents={false}
            currentUserId={user?.id}
            onMemberAction={dialogs.setMemberAction}
            onReload={() => useSpacesStore.getState().loadMembers(spaceId)}
            onError={(message) => useSpacesStore.setState({ error: message || null })}
          />
        ) : (
          <>
            <MemberList
              members={members}
              loading={state.membersLoading}
              owner={state.canManageMembers}
              currentUserId={user?.id}
              onAction={dialogs.setMemberAction}
            />
          </>
        )}

        {state.canInvite ? (
          <PendingInvitationsCard
            spaceId={spaceId}
            invitations={state.pendingInvitations}
            onReloadInvitations={state.loadPendingInvitations}
            onReloadSpaces={state.load}
          />
        ) : null}
      </div>

      <InviteMemberDialog dialogs={dialogs} spaceName={space?.name ?? "Space"} />
      <MemberActionDialog dialogs={dialogs} />
    </div>
  );
}
