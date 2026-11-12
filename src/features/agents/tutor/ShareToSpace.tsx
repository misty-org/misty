import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { useSpaceWindowStore, useSpacesDirectory, windowSpace } from "@/features/app-windows";
import { Button } from "@/shared/ui";

/**
 * Puts something from Tutor in this window's Space as a note, which its members can read. Sharing
 * again updates that note. The button says where it went once it has.
 */
export function ShareToSpace({
  shared,
  onShare,
  onError,
}: {
  shared?: { spaceId: string };
  onShare(spaceId: string): Promise<void>;
  onError(message: string): void;
}) {
  // Read again when the window shows another Space.
  useSpaceWindowStore((state) => state.identity);
  const space = useSpacesDirectory((state) => windowSpace(state.spaces));
  const [busy, setBusy] = useState(false);
  if (!space) return null;
  const here = shared?.spaceId === space.id;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        onShare(space.id)
          .catch((reason: unknown) =>
            onError(reason instanceof Error ? reason.message : String(reason)),
          )
          .finally(() => setBusy(false));
      }}
    >
      {here ? <Check size={15} /> : <Share2 size={15} />}
      <span className={busy ? "misty-shimmer" : undefined}>
        {here ? `Update in ${space.name}` : `Share to ${space.name}`}
      </span>
    </Button>
  );
}
