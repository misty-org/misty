import { PresenceFace } from "@misty/ui";
import { useAccountPresence } from "@/shared/lib/account_presence";
import { ChatAvatar } from "../chat/components/ChatAvatar";
import { useMemberPicture } from "../members/member_pictures";

export function PersonFace(props: {
  id: string;
  name: string;
  pictureVersion?: number;
  outline?: string;
  me?: boolean;
  noPresence?: boolean;
}) {
  const picture = useMemberPicture(props.id, props.pictureVersion ?? 0);
  const account = useAccountPresence((state) => state.byUser[props.id]);
  const face = (
    <ChatAvatar
      id={props.id}
      name={props.name}
      src={picture ?? undefined}
      outline={props.outline}
    />
  );
  if (props.noPresence) return face;
  return (
    <PresenceFace presence={account ?? (props.me ? "online" : "offline")}>{face}</PresenceFace>
  );
}
