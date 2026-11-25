import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { ChatAvatar } from "../chat/components/ChatAvatar";
import { useSpacesStore } from "../list/use_spaces_store";
import { useMemberPicture } from "./member_pictures";

export function MemberFace({
  spaceId,
  userId,
  name,
}: {
  spaceId: string;
  userId: string;
  name: string;
}) {
  const member = useSpacesStore((state) =>
    state.membersBySpace[spaceId]?.find((item) => item.user_id === userId),
  );
  const picture = useMemberPicture(userId, member?.avatar_version ?? 0);
  return (
    <ChatAvatar
      id={userId}
      name={name}
      size="lg"
      src={picture ?? undefined}
      outline={avatarOutline(member?.avatar_decoration)}
    />
  );
}
