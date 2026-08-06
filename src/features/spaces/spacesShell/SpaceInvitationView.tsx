import { useState } from "react";
import { Check, LockKeyhole } from "lucide-react";
import { Button } from "@/ui";
import type { SpaceInvitation } from "@/models/interfaces/features/spaces/types";
import { invitedSpacePreview } from "../spaceInvitation";
import { SpaceAvatar } from "../components/SpaceAvatar";

export function SpaceInvitationSidebar({ invitation }: { invitation: SpaceInvitation }) {
  const space = invitedSpacePreview(invitation);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="-mt-3 flex min-h-14 shrink-0 -translate-y-1.5 items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-2">
          <SpaceAvatar space={space} className="size-8" />
          <div className="min-w-0">
            <p className="m-0 truncate text-[13px] font-semibold text-sidebar-accent-foreground">
              {space.name}
            </p>
            <p className="mb-0 mt-0.5 text-[10px] text-muted-foreground">Invited</p>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <LockKeyhole className="size-4 text-muted-foreground" aria-hidden="true" />
        <p className="mb-0 mt-2 text-xs font-medium">Invitation pending</p>
        <p className="mb-0 mt-1 text-[11px] leading-4 text-muted-foreground">
          Accept to open this Space.
        </p>
      </div>
    </div>
  );
}

export function SpaceInvitationView({
  invitation,
  error,
  onRespond,
}: {
  invitation: SpaceInvitation;
  error?: string;
  onRespond: (accept: boolean) => Promise<void>;
}) {
  const space = invitedSpacePreview(invitation);
  const [response, setResponse] = useState<"accept" | "decline" | "">("");

  const respond = async (accept: boolean) => {
    setResponse(accept ? "accept" : "decline");
    try {
      await onRespond(accept);
    } finally {
      setResponse("");
    }
  };

  return (
    <section
      className="grid h-full min-h-0 place-items-center bg-background px-6 py-10 text-center"
      aria-label={`${space.name} invitation`}
    >
      <div className="flex w-full max-w-md flex-col items-center">
        <div className="relative">
          <SpaceAvatar space={space} className="size-14 ring-1 ring-border" />
          <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border-2 border-background bg-foreground text-background">
            <LockKeyhole className="size-3" strokeWidth={2.2} aria-hidden="true" />
          </span>
        </div>
        <h1 className="mb-0 mt-4 text-xl font-semibold">{space.name}</h1>
        <p className="mb-0 mt-2 text-sm leading-6 text-muted-foreground">
          {invitation.inviter_name || "A Space owner"} invited you to this Space. Its conversations,
          plans, Journal, and Library stay private until you accept.
        </p>
        {error ? (
          <p className="mb-0 mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex items-center gap-2">
          <Button type="button" disabled={Boolean(response)} onClick={() => void respond(true)}>
            <Check className="size-4" />
            {response === "accept" ? "Accepting…" : "Accept invitation"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(response)}
            onClick={() => void respond(false)}
          >
            {response === "decline" ? "Declining…" : "Decline"}
          </Button>
        </div>
      </div>
    </section>
  );
}
