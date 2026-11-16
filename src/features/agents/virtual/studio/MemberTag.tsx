import { Avatar, AvatarFallback, AvatarImage, SceneNameTag } from "@/shared/ui";
import { initialOf } from "../teamMembers";
import type { Actor } from "./behaviour";

/**
 * A member's name over their head: their own picture, their name, and where in Misty they are.
 * Picking it opens the panel to talk to them.
 */
export function MemberTag(props: { actor: Actor; selected: boolean; onPick(id: string): void }) {
  const { actor, selected } = props;
  return (
    <SceneNameTag
      type="button"
      name={actor.name}
      mark={
        <Avatar size="xs" aria-hidden="true">
          {actor.picture ? <AvatarImage src={actor.picture} alt="" /> : null}
          <AvatarFallback>{initialOf(actor.name)}</AvatarFallback>
        </Avatar>
      }
      line={actor.where || undefined}
      state="resting"
      selected={selected}
      data-kind="member"
      data-selected={selected || undefined}
      aria-label={[actor.name, actor.where].filter(Boolean).join(", ")}
      onClick={() => props.onPick(actor.id)}
    />
  );
}
