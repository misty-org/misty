import type { SpaceInvitation } from "../api/dto/entities";
import { Button, OverflowFadeText } from "@/shared/ui";
import { Check } from "lucide-react";

/** Pending Space invitations, shown above the Space list in the side panel. */
export function SpaceInvitationsNotice({
  invitations,
  onRespond,
}: {
  invitations: SpaceInvitation[];
  onRespond: (invitationId: string, accept: boolean) => void;
}) {
  if (invitations.length === 0) return null;

  return (
    <section
      className="grid gap-1.5 rounded-md bg-charcoal-active p-2"
      aria-label="Space invitations"
    >
      <p className="m-0 px-1 text-xs font-semibold text-cream-muted">Invitations</p>
      {invitations.map((invite) => (
        <article key={invite.id} className="rounded-md bg-charcoal-active p-2.5 text-sm">
          <OverflowFadeText as="p" full className="m-0 font-medium text-cream-bright">
            {invite.space_name}
          </OverflowFadeText>
          <div className="mt-2 flex gap-1">
            <Button
              className="px-2 text-xs"
              variant="secondary"
              type="button"
              icon={Check}
              onClick={() => onRespond(invite.id, true)}
            >
              Accept
            </Button>
            <Button
              className="px-2 text-xs"
              variant="quiet"
              type="button"
              onClick={() => onRespond(invite.id, false)}
            >
              Decline
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}
