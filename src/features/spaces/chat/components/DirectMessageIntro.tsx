import { useEffect, useState } from "react";

import { spacesApi } from "../../api/api";
import { useSpacesStore } from "../../list/use_spaces_store";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { ChannelWelcome } from "@misty/ui";
import { ChatAvatar } from "./ChatAvatar";

interface DirectRecipient {
  userId: string;
  name: string;
}

export function DirectMessageIntro({
  spaceId,
  recipient,
}: {
  spaceId: string;
  recipient: DirectRecipient;
}) {
  const avatarUrl = useMemberAvatarUrl(spaceId, recipient.userId);
  const outline = useSpacesStore((state) =>
    avatarOutline(
      state.membersBySpace[spaceId]?.find((member) => member.user_id === recipient.userId)
        ?.avatar_decoration,
    ),
  );
  return (
    <ChannelWelcome
      align="center"
      mark={
        <ChatAvatar
          id={recipient.userId}
          name={recipient.name}
          src={avatarUrl || undefined}
          size="xl"
          outline={outline}
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
      .personAvatar(userId)
      .then((blob) => {
        if (canceled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [spaceId, userId]);

  return url;
}
