import { Check, Forward, Hammer } from "lucide-react";
import { useUserStore } from "@/features/account/core";
import { Surface, Text } from "@/shared/ui";
import type { SpaceMessage } from "../api/dto/entities";
import { useHandledHandoffs } from "./handledHandoffs";
import { HandoffActions } from "./HandoffActions";
import { handoffIsFor, type SpacePost } from "./spacePosts";

const cardClass = "mt-1 grid max-w-2xl gap-2 px-4 py-3";
const labelClass = "flex items-center gap-1.5 text-xs font-medium";

/**
 * A handoff or a claim in the Space chat, drawn as a card in place of the plain message. The
 * person a handoff is for gets its two answers; everyone else just reads it.
 */
export function SpacePostCard(props: {
  message: SpaceMessage;
  post: SpacePost;
  spaceId: string;
  /** The chat is a direct message, so a handoff in it is for the other person. */
  direct: boolean;
  onError: (message: string) => void;
}) {
  const { message, post } = props;
  const me = useUserStore((state) => state.me?.id ?? "");
  const handled = useHandledHandoffs(me, props.spaceId);
  if (post.kind === "claim")
    return (
      <Surface tone="page" edge="hairline" radius="xl" className={cardClass}>
        <Text bare tone="muted" className={labelClass}>
          <Hammer aria-hidden="true" />
          Working on
        </Text>
        <Text tone="default" wrap className="m-0 text-md leading-6">
          {post.text}
        </Text>
      </Surface>
    );
  const forMe = handoffIsFor(message, me, props.direct);
  return (
    <Surface tone="page" edge="hairline" radius="xl" className={cardClass}>
      <Text bare tone="muted" className={labelClass}>
        <Forward aria-hidden="true" />
        Handoff
      </Text>
      <Text tone="default" wrap className="m-0 whitespace-pre-wrap text-md leading-6">
        {post.text}
      </Text>
      {!forMe ? null : handled.includes(message.id) ? (
        <Text bare tone="muted" className="flex items-center gap-1.5 text-xs">
          <Check aria-hidden="true" />
          Answered
        </Text>
      ) : (
        <HandoffActions
          spaceId={props.spaceId}
          me={me}
          handoffId={message.id}
          text={post.text}
          onError={props.onError}
        />
      )}
    </Surface>
  );
}
