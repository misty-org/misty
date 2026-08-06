import { Check } from "lucide-react";
import { Button } from "@/ui";
import type { SpaceInvitation } from "@/models/interfaces/features/spaces/types";

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
          <p className="m-0 truncate font-medium text-cream-bright">{invite.space_name}</p>
          <div className="mt-2 flex gap-1">
            <Button
              className="h-8 px-2 text-xs"
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => onRespond(invite.id, true)}
            >
              <Check size={13} />
              Accept
            </Button>
            <Button
              className="h-8 px-2 text-xs"
              size="sm"
              variant="ghost"
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
