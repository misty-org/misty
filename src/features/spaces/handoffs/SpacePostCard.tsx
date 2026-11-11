import { Check, Forward, Hammer } from "lucide-react";
import { useUserStore } from "@/features/account/core";
import type { SpaceMessage } from "../api/dto/entities";
import { useHandledHandoffs } from "./handledHandoffs";
import { HandoffActions } from "./HandoffActions";
import { handoffIsFor, type SpacePost } from "./spacePosts";

const cardClass =
  "mt-1 grid max-w-2xl gap-2 rounded-xl border border-charcoal-border bg-charcoal-bg px-4 py-3";
const labelClass = "flex items-center gap-1.5 text-xs font-medium text-cream-muted";

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
      <div className={cardClass}>
        <span className={labelClass}>
          <Hammer className="size-3.5" aria-hidden="true" />
          Working on
        </span>
        <p className="m-0 text-md leading-6 text-cream/90 [overflow-wrap:anywhere]">{post.text}</p>
      </div>
    );
  const forMe = handoffIsFor(message, me, props.direct);
  return (
    <div className={cardClass}>
      <span className={labelClass}>
        <Forward className="size-3.5" aria-hidden="true" />
        Handoff
      </span>
      <p className="m-0 whitespace-pre-wrap text-md leading-6 text-cream/90 [overflow-wrap:anywhere]">
        {post.text}
      </p>
      {!forMe ? null : handled.includes(message.id) ? (
        <span className="flex items-center gap-1.5 text-xs text-cream-muted">
          <Check className="size-3.5" aria-hidden="true" />
          Answered
        </span>
      ) : (
        <HandoffActions
          spaceId={props.spaceId}
          me={me}
          handoffId={message.id}
          text={post.text}
          onError={props.onError}
        />
      )}
    </div>
  );
}
