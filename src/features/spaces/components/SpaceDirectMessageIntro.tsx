import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/ui";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";

export interface DirectRecipient {
  userId: string;
  name: string;
}

/**
 * The opening screen for an empty direct conversation: a large avatar, the
 * recipient's name, and a line marking the start of the history — the way a
 * one-on-one thread announces itself before anyone has spoken.
 */
export function SpaceDirectMessageIntro({
  spaceId,
  recipient,
}: {
  spaceId: string;
  recipient: DirectRecipient;
}) {
  const avatarUrl = useMemberAvatarUrl(spaceId, recipient.userId);

  return (
    <div className="flex h-full flex-col justify-end pb-4">
      <Avatar className="size-20">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-2xl font-semibold">
          {initials(recipient.name)}
        </AvatarFallback>
      </Avatar>
      <h2 className="mt-4 text-[28px] font-bold leading-tight tracking-tight text-cream">
        {recipient.name}
      </h2>
      <p className="mt-0.5 text-lg font-semibold text-cream-muted">{recipient.name}</p>
      <p className="mt-3 text-sm text-cream-muted">
        This is the beginning of your direct message history with{" "}
        <strong className="font-semibold text-cream">{recipient.name}</strong>.
      </p>
    </div>
  );
}

function useMemberAvatarUrl(spaceId: string, userId: string): string {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let canceled = false;
    let objectUrl = "";
    setUrl("");
    void spacesApi
      .memberAvatar(spaceId, userId)
      .then((blob) => {
        if (canceled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        /* No avatar set — the initials fallback covers it. */
      });
    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [spaceId, userId]);

  return url;
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
