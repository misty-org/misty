import type { MemberAction } from "./SpaceMembers";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import type { SpaceMembersState } from "./useSpaceMembers";

/**
 * The invite dialog and the transfer/remove confirmation. Once an
 * invitation is made (or given a new link) the dialog shows its link to copy and pass on.
 *
 * Both leave their errors to the shared Spaces store, which is why the failure
 * branches here are empty — the dialogs render `store.error` directly.
 */
export function useMemberDialogs(spaceId: string, state: SpaceMembersState, startInvite = false) {
  const location = useLocation();
  const { owner, invite, removeMember, transferOwner, clearError } = state;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [invitedLink, setInvitedLink] = useState<{ email: string; link: string } | null>(null);
  const [memberAction, setMemberAction] = useState<MemberAction>();
  const [actionBusy, setActionBusy] = useState(false);

  // ?invite=1, or People's Invite, opens the dialog straight away.
  useEffect(() => {
    if (owner && (startInvite || new URLSearchParams(location.search).get("invite") === "1"))
      setInviteOpen(true);
  }, [location.search, owner, startInvite]);

  const closeInvite = useCallback(() => {
    if (inviting) return;
    setInviteOpen(false);
    setInviteEmail("");
    setInvitedLink(null);
    clearError();
  }, [clearError, inviting]);

  /** Opens the dialog on an invitation's link, as right after inviting. */
  const showInviteLink = useCallback(
    (email: string, link: string) => {
      clearError();
      setInvitedLink({ email, link });
      setInviteOpen(true);
    },
    [clearError],
  );

  const openInvite = () => {
    clearError();
    setInviteOpen(true);
  };

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    try {
      const link = await invite(spaceId, email);
      await state.loadPendingInvitations();
      setInviteEmail("");
      if (link) setInvitedLink({ email, link });
      else setInviteOpen(false);
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

  return {
    inviteOpen,
    setInviteOpen,
    inviteEmail,
    setInviteEmail,
    inviting,
    openInvite,
    closeInvite,
    submitInvite,
    invitedLink,
    showInviteLink,
    memberAction,
    setMemberAction,
    actionBusy,
    confirmMemberAction,
  };
}

export type MemberDialogsState = ReturnType<typeof useMemberDialogs>;
