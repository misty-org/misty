import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Button, Card } from "@/shared/ui";

export function SpaceSetupCards({
  spaceId,
  isOwner,
  showInvitation = false,
  dismissible = false,
}: {
  spaceId: string;
  isOwner: boolean;
  showInvitation?: boolean;
  dismissible?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !showInvitation || !isOwner) return null;

  return (
    <Card className="mx-4 mt-3 grid gap-3 border-charcoal-active/20 bg-charcoal-active p-3 shadow-none">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-medium">Your Space is ready</p>
          <p className="mb-0 mt-1 text-xs text-cream-muted">
            Invite someone to start collaborating in Social, Planner, Journal, and the Library.
          </p>
        </div>
        {dismissible ? (
          <Button
            className="size-7 shrink-0"
            size="icon"
            variant="ghost"
            type="button"
            aria-label="Dismiss setup"
            onClick={() => setDismissed(true)}
          >
            <X size={14} />
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to={`/spaces/${encodeURIComponent(spaceId)}/settings/members?invite=1`}>
            <UserPlus size={14} /> Invite people
          </Link>
        </Button>
      </div>
    </Card>
  );
}
