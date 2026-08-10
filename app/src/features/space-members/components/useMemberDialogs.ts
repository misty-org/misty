import type { MemberAction } from "@/services/spaces/dto/types/components/SpaceMembers";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import type { SpaceMembersState } from "./useSpaceMembers";

/**
 * The invite dialog and the transfer/remove confirmation.
 *
 * Both leave their errors to the shared Spaces store, which is why the failure
 * branches here are empty — the dialogs render `store.error` directly.
 */
export function useMemberDialogs(spaceId: string, state: SpaceMembersState) {
  const location = useLocation();
  const { owner, invite, removeMember, transferOwner, clearError } = state;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [memberAction, setMemberAction] = useState<MemberAction>();
  const [actionBusy, setActionBusy] = useState(false);

  // ?invite=1 opens the dialog straight from a link.
  useEffect(() => {
    if (owner && new URLSearchParams(location.search).get("invite") === "1") setInviteOpen(true);
  }, [location.search, owner]);

  const closeInvite = useCallback(() => {
    if (inviting) return;
    setInviteOpen(false);
    setInviteEmail("");
    clearError();
  }, [clearError, inviting]);

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
      await invite(spaceId, email);
      await state.loadPendingInvitations();
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

  return {
    inviteOpen,
    setInviteOpen,
    inviteEmail,
    setInviteEmail,
    inviting,
    openInvite,
    closeInvite,
    submitInvite,
    memberAction,
    setMemberAction,
    actionBusy,
    confirmMemberAction,
  };
}

export type MemberDialogsState = ReturnType<typeof useMemberDialogs>;
