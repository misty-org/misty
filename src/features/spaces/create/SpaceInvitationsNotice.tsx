import type { SpaceInvitation } from "../api/dto/entities";
import { Button, RowGroupSection, Text } from "@misty/ui";
import { Check } from "lucide-react";

export function SpaceInvitationsNotice({
  invitations,
  onRespond,
}: {
  invitations: SpaceInvitation[];
  onRespond: (invitationId: string, accept: boolean) => void;
}) {
  if (invitations.length === 0) return null;

  return (
    <RowGroupSection title="Invitations" className="text-left">
      {invitations.map((invite) => (
        <article key={invite.id} className="p-2.5">
          <Text as="p" size="control" tone="default" full className="m-0">
            {invite.space_name}
          </Text>
          <div className="mt-2 flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              type="button"
              icon={Check}
              onClick={() => onRespond(invite.id, true)}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="quiet"
              type="button"
              onClick={() => onRespond(invite.id, false)}
            >
              Decline
            </Button>
          </div>
        </article>
      ))}
    </RowGroupSection>
  );
}
