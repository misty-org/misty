import { spacesApi } from "@/services/spaces/api";
import type { SpaceInvitation } from "@/services/spaces/dto/interfaces/types";
import { Button, Card } from "@/shared/ui";
import { RefreshCcw, XCircle } from "lucide-react";
import { useState } from "react";

const deliveryLabel = (status: SpaceInvitation["delivery_status"]) =>
  status === "failed"
    ? "Delivery failed—ready to retry"
    : status === "sent"
      ? "Invitation sent"
      : "Waiting to send";

/** Outstanding invitations, with resend and revoke. Owner-only. */
export function PendingInvitationsCard({
  spaceId,
  invitations,
  onReloadInvitations,
  onReloadSpaces,
}: {
  spaceId: string;
  invitations: SpaceInvitation[];
  onReloadInvitations: () => Promise<void>;
  onReloadSpaces: () => Promise<unknown>;
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
              {deliveryLabel(invitation.delivery_status)}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() =>
              run(`resend:${invitation.id}`, () =>
                spacesApi.resendInvitation(spaceId, invitation.id).then(onReloadInvitations),
              )
            }
          >
            <RefreshCcw
              className={`size-3.5 ${busyAction === `resend:${invitation.id}` ? "animate-spin" : ""}`}
            />
            Resend
          </Button>
          <Button
            size="icon"
            variant="ghost"
            type="button"
            disabled={Boolean(busyAction)}
            aria-label={`Revoke invitation for ${invitation.invited_email}`}
            onClick={() =>
              run(`revoke:${invitation.id}`, () =>
                spacesApi
                  .revokeInvitation(spaceId, invitation.id)
                  .then(() => Promise.all([onReloadInvitations(), onReloadSpaces()])),
              )
            }
          >
            <XCircle className="size-4" />
          </Button>
        </div>
      ))}
    </Card>
  );
}
