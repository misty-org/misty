import { Avatar, AvatarFallback, AvatarImage, type AvatarSize } from "@misty/ui";
import { personTone } from "@/features/agents";
import { personInitials } from "@/shared/lib/person_initials";

export function ChatAvatar(props: {
  id: string;
  name: string;
  src?: string;
  size?: AvatarSize;
  outline?: string;
}) {
  return (
    <Avatar size={props.size} tone={personTone(props.id)} outline={props.outline}>
      {props.src ? <AvatarImage src={props.src} alt="" /> : null}
      <AvatarFallback>{personInitials(props.name)}</AvatarFallback>
    </Avatar>
  );
}
