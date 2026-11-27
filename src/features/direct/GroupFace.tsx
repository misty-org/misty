import { Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, type AvatarSize } from "@misty/ui";
import { useSpacePicture } from "@/features/spaces";
import type { DirectConversation } from "./api";

export function GroupFace({ dm, size = "sm" }: { dm: DirectConversation; size?: AvatarSize }) {
  const picture = useSpacePicture(dm.id, dm.avatar_version ?? 0);
  return (
    <Avatar size={size} tone="sand">
      {picture ? <AvatarImage src={picture} alt="" /> : null}
      <AvatarFallback>
        <Users aria-hidden="true" />
      </AvatarFallback>
    </Avatar>
  );
}
