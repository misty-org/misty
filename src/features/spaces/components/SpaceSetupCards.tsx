import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Button, IconButton, Surface, Text } from "@misty/ui";

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
    <Surface tone="faint" radius="xl" className="mx-4 mt-3 grid gap-3 overflow-hidden p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Text as="p" size="control" tone="default" weight="medium" wrap className="m-0">
            Your Space is ready
          </Text>
          <Text as="p" size="meta" tone="muted" wrap className="mb-0 mt-1">
            Invite someone to chat, write docs, draw and share files here, with their agents.
          </Text>
        </div>
        {dismissible ? (
          <IconButton label="Dismiss setup" onClick={() => setDismissed(true)}>
            <X />
          </IconButton>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button asChild variant="secondary">
          <Link to={`/spaces/${encodeURIComponent(spaceId)}/settings/members?invite=1`}>
            <UserPlus /> Invite people
          </Link>
        </Button>
      </div>
    </Surface>
  );
}
