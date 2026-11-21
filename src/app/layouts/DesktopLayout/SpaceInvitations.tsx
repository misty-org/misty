import { Check, X } from "lucide-react";
import { useState } from "react";
import { switchSpaceWindow } from "@/features/app-windows";
import { useSpacesStore } from "@/features/spaces";
import { IconButton, ListRow, NavGroupHeading, notify } from "@misty/ui";
import { chatSectionClass } from "./styles";

/** Whether an invitation to a shared Space waits on the person. */
export function useSpaceInvitationWaiting(): boolean {
  return useSpacesStore((state) => state.invitations.length > 0);
}

/**
 * The invitations to shared Spaces that wait on the person, at the top of the sidebar's Spaces
 * side: each Space by name with who sent it, and Accept or Decline. Accepting opens the Space.
 */
export function SpaceInvitations() {
  const invitations = useSpacesStore((state) => state.invitations);
  const respondInvite = useSpacesStore((state) => state.respondInvite);
  const [answering, setAnswering] = useState<string | null>(null);
  if (!invitations.length) return null;

  const respond = async (inviteId: string, spaceId: string, accept: boolean) => {
    setAnswering(inviteId);
    try {
      await respondInvite(inviteId, accept);
      if (accept) switchSpaceWindow(spaceId, false);
    } catch {
      notify({
        message: accept
          ? "The invitation couldn't be accepted."
          : "The invitation couldn't be declined.",
        tone: "error",
      });
    } finally {
      setAnswering(null);
    }
  };

  return (
    <section className={chatSectionClass} aria-label="Invitations">
      <NavGroupHeading name="Invitations" />
      {invitations.map((invite) => (
        <ListRow
          key={invite.id}
          label={invite.space_name}
          description={invite.inviter_name ? `From ${invite.inviter_name}` : undefined}
          trailing={
            <>
              <IconButton
                label="Accept"
                disabled={answering === invite.id}
                onClick={() => void respond(invite.id, invite.space_id, true)}
              >
                <Check />
              </IconButton>
              <IconButton
                label="Decline"
                disabled={answering === invite.id}
                onClick={() => void respond(invite.id, invite.space_id, false)}
              >
                <X />
              </IconButton>
            </>
          }
        />
      ))}
    </section>
  );
}
