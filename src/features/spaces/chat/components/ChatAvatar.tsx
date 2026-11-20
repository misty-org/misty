import { Avatar, AvatarFallback, AvatarImage, type AvatarSize } from "@misty/ui";
import { personTone } from "@/features/agents";
import { personInitials } from "@/shared/lib/personInitials";

/** A person in Space chat: their picture, or their initials in their own tone. */
export function ChatAvatar(props: {
  /** Whose tone the initials take: the person's id, or a chat's when it has no one person. */
  id: string;
  name: string;
  src?: string;
  size?: AvatarSize;
}) {
  return (
    <Avatar size={props.size} tone={personTone(props.id)}>
      {props.src ? <AvatarImage src={props.src} alt="" /> : null}
      <AvatarFallback>{personInitials(props.name)}</AvatarFallback>
    </Avatar>
  );
}
