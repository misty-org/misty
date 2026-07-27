import type { MemberAction } from "@/models/types/features/spaces/components/SpaceMembers";
export type { MemberAction } from "@/models/types/features/spaces/components/SpaceMembers";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Ellipsis,
  Mail,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import { Avatar, AvatarFallback } from "@/ui";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Card } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import { Input } from "@/ui";
import { Skeleton } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import type { SpaceInvitation, SpaceMember } from "@/models/interfaces/features/spaces/types";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";

export function SpaceMembers({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const location = useLocation();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [memberAction, setMemberAction] = useState<MemberAction>();
  const [actionBusy, setActionBusy] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState<SpaceInvitation[]>([]);
  const [invitationAction, setInvitationAction] = useState("");
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const { membersBySpace, loading, error, invite, removeMember, transferOwner, load, clearError } =
    useSpacesStore(
      useShallow((state) => ({
        membersBySpace: state.membersBySpace,
        loading: state.loading,
        error: state.error,
        invite: state.invite,
        removeMember: state.removeMember,
        transferOwner: state.transferOwner,
        load: state.load,
        clearError: state.clearError,
      })),
    );
  const members = membersBySpace[spaceId] ?? [];
  const [membersLoading] = useMinimumSpin(loading && members.length === 0);
  const owner = space?.role === "owner";
  const canInvite = owner;

  useEffect(() => {
    if (owner && new URLSearchParams(location.search).get("invite") === "1") setInviteOpen(true);
  }, [location.search, owner]);
  const loadPendingInvitations = useCallback(async () => {
    if (!owner) {
      setPendingInvitations([]);
      return;
    }
    try {
      setPendingInvitations((await spacesApi.pendingInvitations(spaceId)).invitations);
    } catch {
      setPendingInvitations([]);
    }
  }, [owner, spaceId]);
  useEffect(() => {
    void loadPendingInvitations();
  }, [loadPendingInvitations]);

  const closeInvite = useCallback(() => {
    if (inviting) return;
    setInviteOpen(false);
    setInviteEmail("");
    clearError();
  }, [clearError, inviting]);
  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    try {
      await invite(spaceId, email);
      await loadPendingInvitations();
      setInviteEmail("");
      setInviteOpen(false);
    } catch {
      // The shared store error is rendered in the dialog.
    } finally {
      setInviting(false);
    }
  };
  const confirmMemberAction = async () => {
    if (!memberAction || actionBusy) return;
    setActionBusy(true);
    clearError();
    try {
      if (memberAction.kind === "transfer")
        await transferOwner(spaceId, memberAction.member.user_id);
      else await removeMember(spaceId, memberAction.member.user_id);
      setMemberAction(undefined);
    } catch {
      // The shared store error remains visible in the confirmation dialog.
    } finally {
      setActionBusy(false);
    }
  };

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
          {canInvite ? (
            <Button
              type="button"
              onClick={() => {
                clearError();
                setInviteOpen(true);
              }}
            >
              <UserPlus className="size-4" /> Invite member
            </Button>
          ) : null}
        </div>

        {error && !inviteOpen && !memberAction ? (
          <Button
            className="mb-3 h-auto w-full justify-start whitespace-normal rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/15 hover:text-destructive"
            variant="ghost"
            type="button"
            onClick={clearError}
          >
            {error}
          </Button>
        ) : null}

        <Card className="overflow-hidden" aria-label="Space members">
          {membersLoading ? (
            <div aria-busy="true" role="status">
              <span className="sr-only">Loading members</span>
              {[0, 1, 2, 3].map((index) => (
                <div
                  className={`flex min-h-[72px] min-w-0 items-center gap-3 px-4 py-3 ${index ? "border-t border-border/60" : ""}`}
                  key={index}
                >
                  <Skeleton className="size-10 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 grid gap-2">
                    <Skeleton className="h-3.5 w-32 rounded" />
                    <Skeleton className="h-3 w-44 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            members.map((member, index) => (
              <div
                className={[
                  "group flex min-h-[72px] min-w-0 items-center gap-3 px-4 py-3",
                  "transition-colors hover:bg-muted/50",
                  index ? "border-t border-border/60" : "",
                ].join(" ")}
                key={member.user_id}
              >
                <Avatar className="size-10 shrink-0">
                  <AvatarFallback className="text-xs font-semibold">
                    {memberInitials(member.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="m-0 truncate text-sm font-medium text-foreground">
                      {member.name}
                    </p>
                    {member.user_id === user?.id ? <Badge variant="secondary">You</Badge> : null}
                  </div>
                  <p className="mb-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <Mail className="size-3 shrink-0" /> {member.email}
                  </p>
                </div>
                <Badge className="hidden capitalize sm:inline-flex" variant="outline">
                  {member.role}
                </Badge>
                {owner && member.role !== "owner" ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          type="button"
                          aria-label={`Actions for ${member.name}`}
                        >
                          <Ellipsis className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setMemberAction({ kind: "transfer", member })}
                        >
                          <ShieldCheck className="mr-2 size-4" /> Transfer ownership
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setMemberAction({ kind: "remove", member })}
                        >
                          <Trash2 className="mr-2 size-4" /> Remove member
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>
            ))
          )}
          {!membersLoading && !members.length ? (
            <div className="grid min-h-56 place-items-center p-6 text-center">
              <div>
                <Users className="mx-auto size-6 text-muted-foreground" />
                <p className="mb-0 mt-3 text-sm font-medium">No members loaded</p>
                <p className="mb-0 mt-1 text-xs text-muted-foreground">
                  Members will appear when access data is available.
                </p>
              </div>
            </div>
          ) : null}
        </Card>

        {owner && pendingInvitations.length ? (
          <Card className="mt-4 overflow-hidden" aria-label="Pending invitations">
            <div className="border-b border-border/60 px-4 py-3">
              <h3 className="m-0 text-sm font-medium">Pending invitations</h3>
            </div>
            {pendingInvitations.map((invitation) => (
              <div
                className="flex min-h-14 items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0"
                key={invitation.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm">{invitation.invited_email}</p>
                  <p className="mb-0 mt-0.5 text-xs text-muted-foreground">
                    {invitation.delivery_status === "failed"
                      ? "Delivery failed—ready to retry"
                      : invitation.delivery_status === "sent"
                        ? "Invitation sent"
                        : "Waiting to send"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={Boolean(invitationAction)}
                  onClick={() => {
                    setInvitationAction(`resend:${invitation.id}`);
                    void spacesApi
                      .resendInvitation(spaceId, invitation.id)
                      .then(() => loadPendingInvitations())
                      .finally(() => setInvitationAction(""));
                  }}
                >
                  <RefreshCcw
                    className={`size-3.5 ${invitationAction === `resend:${invitation.id}` ? "animate-spin" : ""}`}
                  />
                  Resend
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  disabled={Boolean(invitationAction)}
                  aria-label={`Revoke invitation for ${invitation.invited_email}`}
                  onClick={() => {
                    setInvitationAction(`revoke:${invitation.id}`);
                    void spacesApi
                      .revokeInvitation(spaceId, invitation.id)
                      .then(async () => {
                        await Promise.all([loadPendingInvitations(), load()]);
                      })
                      .finally(() => setInvitationAction(""));
                  }}
                >
                  <XCircle className="size-4" />
                </Button>
              </div>
            ))}
          </Card>
        ) : null}
      </div>

      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => (open ? setInviteOpen(true) : closeInvite())}
      >
        <DialogContent className="max-w-sm">
          <form onSubmit={(event) => void submitInvite(event)}>
            <DialogHeader>
              <DialogTitle>Invite to {space?.name ?? "Space"}</DialogTitle>
              <DialogDescription>
                Anyone can be invited by email. They can create an account or sign in before
                joining. The invitation expires after seven days.
              </DialogDescription>
            </DialogHeader>
            <label className="mt-5 grid gap-2 text-xs font-medium text-muted-foreground">
              Email address
              <Input
                autoFocus
                type="email"
                autoComplete="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
            </label>
            {error ? (
              <p
                className="mb-0 mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <DialogFooter className="mt-5">
              <Button variant="outline" type="button" disabled={inviting} onClick={closeInvite}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviting || !inviteEmail.trim()}>
                {inviting ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(memberAction)}
        onOpenChange={(open) => !open && !actionBusy && setMemberAction(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {memberAction?.kind === "transfer"
                ? "Transfer Space ownership?"
                : "Remove this member?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {memberAction?.kind === "transfer"
                ? `${memberAction.member.name} will become the owner and control membership and Space settings.`
                : `${memberAction?.member.name ?? "This member"} will immediately lose access to this Space.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p
              className="m-0 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                memberAction?.kind === "remove"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
              disabled={actionBusy}
              onClick={(event) => {
                event.preventDefault();
                void confirmMemberAction();
              }}
            >
              {actionBusy
                ? "Working…"
                : memberAction?.kind === "transfer"
                  ? "Transfer ownership"
                  : "Remove member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function memberInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
