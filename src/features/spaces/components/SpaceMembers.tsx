export type { MemberAction } from "@/models/types/features/spaces/components/SpaceMembers";

import { UserPlus } from "lucide-react";
import { Button } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { InviteMemberDialog } from "../spaceMembers/InviteMemberDialog";
import { MemberActionDialog } from "../spaceMembers/MemberActionDialog";
import { TeamList } from "../spaceMembers/TeamList";
import { MemberList } from "../spaceMembers/MemberList";
import { AgentMembershipList } from "../spaceMembers/AgentMembershipList";
import { agentTeammatesV1Enabled } from "@/features/agents/flags";
import { PendingInvitationsCard } from "../spaceMembers/PendingInvitationsCard";
import { useMemberDialogs } from "../spaceMembers/useMemberDialogs";
import { useSpaceMembers } from "../spaceMembers/useSpaceMembers";

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
  const { space, members, agents, error, clearError } = state;
  const bannerError = error && !dialogs.inviteOpen && !dialogs.memberAction ? error : "";
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
          {state.canInvite ? (
            <Button type="button" onClick={dialogs.openInvite}>
              <UserPlus className="size-4" /> Invite member
            </Button>
          ) : null}
        </div>

        {bannerError ? (
          <Button
            className="mb-3 h-auto w-full justify-start whitespace-normal rounded-lg border border-charcoal-active/30 bg-charcoal-active px-3 py-2 text-left text-xs text-cream-bright hover:bg-charcoal-active hover:text-cream-bright"
            variant="ghost"
            type="button"
            onClick={clearError}
          >
            {bannerError}
          </Button>
        ) : null}

        {teammatesEnabled ? (
          <TeamList
            spaceId={spaceId}
            members={members}
            agents={agents}
            loading={state.membersLoading}
            owner={state.owner}
            canManageAgents={state.canManageAgents}
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
              owner={state.owner}
              currentUserId={user?.id}
              onAction={dialogs.setMemberAction}
            />
            <AgentMembershipList
              spaceId={spaceId}
              agents={agents}
              canManage={state.canManageAgents}
              onReload={() => useSpacesStore.getState().loadMembers(spaceId)}
              onError={(message) => useSpacesStore.setState({ error: message || null })}
            />
          </>
        )}

        {state.owner ? (
          <PendingInvitationsCard
            spaceId={spaceId}
            invitations={state.pendingInvitations}
            onReloadInvitations={state.loadPendingInvitations}
            onReloadSpaces={state.load}
          />
        ) : null}
      </div>

      <InviteMemberDialog
        dialogs={dialogs}
        spaceName={space?.name ?? "Space"}
        error={error ?? ""}
      />
      <MemberActionDialog dialogs={dialogs} error={error ?? ""} />
    </div>
  );
}
