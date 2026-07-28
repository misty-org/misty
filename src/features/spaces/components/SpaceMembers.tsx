export type { MemberAction } from "@/models/types/features/spaces/components/SpaceMembers";

import { UserPlus } from "lucide-react";
import { Button } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { InviteMemberDialog } from "../spaceMembers/InviteMemberDialog";
import { MemberActionDialog } from "../spaceMembers/MemberActionDialog";
import { MemberList } from "../spaceMembers/MemberList";
import { PendingInvitationsCard } from "../spaceMembers/PendingInvitationsCard";
import { useMemberDialogs } from "../spaceMembers/useMemberDialogs";
import { useSpaceMembers } from "../spaceMembers/useSpaceMembers";

export function SpaceMembers({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const state = useSpaceMembers(spaceId);
  const dialogs = useMemberDialogs(spaceId, state);
  const { space, members, error, clearError } = state;
  const bannerError = error && !dialogs.inviteOpen && !dialogs.memberAction ? error : "";

  return (
    <div className="h-full min-h-0 overflow-auto bg-background px-5 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-sm font-semibold text-foreground">People with access</h2>
            <p className="mb-0 mt-1 text-xs text-muted-foreground">
              {members.length} active member{members.length === 1 ? "" : "s"}
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
            className="mb-3 h-auto w-full justify-start whitespace-normal rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/15 hover:text-destructive"
            variant="ghost"
            type="button"
            onClick={clearError}
          >
            {bannerError}
          </Button>
        ) : null}

        <MemberList
          members={members}
          loading={state.membersLoading}
          owner={state.owner}
          currentUserId={user?.id}
          onAction={dialogs.setMemberAction}
        />

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
