import type { SpaceChatStarter } from "@/api/spaces/dto/interfaces/components/SpaceChatMessages";

const dotClass = "motion-safe:animate-bounce";

/**
 * The opening screen of an empty conversation.
 *
 * It used to pitch three starter cards, which was a lot of furniture for a
 * thread you are about to type in anyway. This matches the Library's empty
 * state instead, with the ellipsis doing the only moving.
 */
export function SpaceChatStarters({
  onStarter,
}: {
  spaceName?: string;
  onStarter?: (starter: SpaceChatStarter) => void;
}) {
  return (
    <div className="grid min-h-48 place-items-center text-sm text-cream-muted">
      {onStarter ? (
        <p className="m-0 flex items-baseline">
          Nothing to see here
          <span aria-hidden="true" className="flex">
            <span className={`${dotClass} [animation-delay:-300ms]`}>.</span>
            <span className={`${dotClass} [animation-delay:-150ms]`}>.</span>
            <span className={dotClass}>.</span>
          </span>
        </p>
      ) : (
        <p className="m-0">You can read this conversation, but you cannot send messages.</p>
      )}
    </div>
  );
}
