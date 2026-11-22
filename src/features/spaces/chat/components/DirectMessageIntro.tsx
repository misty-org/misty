import { useEffect, useState } from "react";

import { spacesApi } from "../../api/api";
import { ChannelWelcome } from "@misty/ui";
import { ChatAvatar } from "./ChatAvatar";

interface DirectRecipient {
  userId: string;
  name: string;
}

/**
 * The opening of a one-to-one conversation's history: the other person's face, their name and
 * where the history with them begins, as Discord opens a direct message.
 */
export function DirectMessageIntro({
  spaceId,
  recipient,
}: {
  spaceId: string;
  recipient: DirectRecipient;
}) {
  const avatarUrl = useMemberAvatarUrl(spaceId, recipient.userId);
  return (
    <ChannelWelcome
      mark={
        <ChatAvatar
          id={recipient.userId}
          name={recipient.name}
          src={avatarUrl || undefined}
          size="xl"
        />
      }
      title={recipient.name}
      line={`This is the beginning of your direct message history with ${recipient.name}.`}
    />
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
