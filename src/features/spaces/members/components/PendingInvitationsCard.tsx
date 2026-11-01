import { spacesApi } from "@/api/spaces/api";
import type { SpaceInvitation } from "@/api/spaces/dto/entities";
import { Button, Card, IconButton } from "@/shared/ui";
import { Link2, XCircle } from "lucide-react";
import { useState } from "react";

const expiresLabel = (expiresAt: string) =>
  `Expires ${new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

/**
 * Outstanding invitations, with a new link and revoke. Owner-only. Only an invitation's hash is
 * kept, so its link can't be shown again: New link makes one (the old one stops working) and
 * shows it in the invite dialog to copy.
 */
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
    <Card className="mt-4 overflow-hidden" aria-label="Pending invitations">
      <div className="border-b border-charcoal-border/60 px-4 py-3">
        <h3 className="m-0 text-sm font-medium">Pending invitations</h3>
      </div>
      {invitations.map((invitation) => (
        <div
          className="flex min-h-14 items-center gap-3 border-b border-charcoal-border/60 px-4 py-3 last:border-0"
          key={invitation.id}
        >
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-sm">{invitation.invited_email}</p>
            <p className="mb-0 mt-0.5 text-xs text-cream-muted">
              {expiresLabel(invitation.expires_at)}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() =>
              run(`link:${invitation.id}`, () =>
                spacesApi.resendInvitation(spaceId, invitation.id).then(async (refreshed) => {
                  if (refreshed.link) onLink(invitation.invited_email, refreshed.link);
                  await onReloadInvitations();
                }),
              )
            }
          >
            <Link2 className="size-3.5" />
            New link
          </Button>
          <IconButton
            size="md"
            label={`Revoke invitation for ${invitation.invited_email}`}
            disabled={Boolean(busyAction)}
            onClick={() =>
              run(`revoke:${invitation.id}`, () =>
                spacesApi
                  .revokeInvitation(spaceId, invitation.id)
                  .then(() => Promise.all([onReloadInvitations(), onReloadSpaces()])),
              )
            }
          >
            <XCircle className="size-4" />
          </IconButton>
        </div>
      ))}
    </Card>
  );
}
