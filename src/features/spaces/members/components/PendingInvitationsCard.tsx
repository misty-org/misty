import { spacesApi } from "../../api/api";
import type { SpaceInvitation } from "../../api/dto/entities";
import { ListRow, MenuItem, RowGroupSection, Text } from "@misty/ui";
import { Link2, XCircle } from "lucide-react";
import { useState } from "react";

const expiresLabel = (expiresAt: string) =>
  `Expires ${new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

export function PendingInvitationsCard({
  spaceId,
  invitations,
  onReloadInvitations,
  onReloadSpaces,
  onLink,
}: {
  spaceId: string;
  invitations: SpaceInvitation[];
  onReloadInvitations: () => Promise<void>;
  onReloadSpaces: () => Promise<unknown>;
  onLink: (email: string, link: string) => void;
}) {
  const [busyAction, setBusyAction] = useState("");
  if (invitations.length === 0) return null;

  const run = (key: string, action: () => Promise<unknown>) => {
    setBusyAction(key);
    void action().finally(() => setBusyAction(""));
  };

  return (
    <RowGroupSection title="Pending invitations" count={invitations.length}>
      {invitations.map((invitation) => (
        <ListRow
          key={invitation.id}
          label={invitation.invited_email}
          trailing={
            <Text bare size="meta" tone="muted">
              {expiresLabel(invitation.expires_at)}
            </Text>
          }
          menuLabel={`Actions for the invitation to ${invitation.invited_email}`}
          menu={
            <>
              <MenuItem
                icon={<Link2 />}
                label="New link"
                disabled={Boolean(busyAction)}
                onSelect={() =>
                  run(`link:${invitation.id}`, () =>
                    spacesApi.resendInvitation(spaceId, invitation.id).then(async (refreshed) => {
                      if (refreshed.link) onLink(invitation.invited_email, refreshed.link);
                      await onReloadInvitations();
                    }),
                  )
                }
              />
              <MenuItem
                icon={<XCircle />}
                label="Revoke invitation"
                danger
                disabled={Boolean(busyAction)}
                onSelect={() =>
                  run(`revoke:${invitation.id}`, () =>
                    spacesApi
                      .revokeInvitation(spaceId, invitation.id)
                      .then(() => Promise.all([onReloadInvitations(), onReloadSpaces()])),
                  )
                }
              />
            </>
          }
        />
      ))}
    </RowGroupSection>
  );
}
