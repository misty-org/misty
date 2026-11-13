import type { SpaceInvitation } from "../api/dto/entities";
import { Button, Surface, Text } from "@/shared/ui";
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
    <Surface
      as="section"
      tone="active"
      radius="md"
      className="grid gap-1.5 p-2"
      aria-label="Space invitations"
    >
      <Text as="p" tone="muted" className="m-0 px-1 text-xs font-semibold">
        Invitations
      </Text>
      {invitations.map((invite) => (
        <Surface as="article" key={invite.id} tone="active" radius="md" className="p-2.5 text-sm">
          <Text as="p" tone="bright" full className="m-0 font-medium">
            {invite.space_name}
          </Text>
          <div className="mt-2 flex gap-1">
            <Button
              className="text-xs"
              variant="secondary"
              type="button"
              icon={Check}
              onClick={() => onRespond(invite.id, true)}
            >
              Accept
            </Button>
            <Button
              className="text-xs"
              variant="quiet"
              type="button"
              onClick={() => onRespond(invite.id, false)}
            >
              Decline
            </Button>
          </div>
        </Surface>
      ))}
    </Surface>
  );
}
