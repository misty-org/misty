import type { SpaceMessage } from "@/services/spaces/dto/interfaces/types";
import { Button } from "@/shared/ui";

/** The reaction pills under a message. Read-only members see counts but cannot toggle. */
export function MessageReactions({
  message,
  canWrite,
  onToggle,
}: {
  message: SpaceMessage;
  canWrite: boolean;
  onToggle: (message: SpaceMessage, emoji: string, reacted: boolean) => void;
}) {
  const reactions = (message.reactions ?? []).filter((reaction) => reaction.count > 0);
  if (reactions.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {reactions.map((reaction) => (
        <Button
          variant="outline"
          size="sm"
          className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors ${
            reaction.reacted_by_me
              ? "border-charcoal-active/35 bg-charcoal-active text-cream-bright hover:bg-charcoal-active"
              : "border-charcoal-border/70 bg-charcoal-card text-cream-muted hover:bg-charcoal-card hover:text-cream"
          } disabled:cursor-default disabled:opacity-80`}
          type="button"
          key={reaction.emoji}
          disabled={!canWrite}
          onClick={() => onToggle(message, reaction.emoji, reaction.reacted_by_me === true)}
          aria-pressed={reaction.reacted_by_me === true}
          aria-label={`${reaction.reacted_by_me ? "Remove" : "Add"} ${reaction.emoji} reaction`}
        >
          <span className="text-sm leading-none">{reaction.emoji}</span>
          <span className="tabular-nums">{reaction.count}</span>
        </Button>
      ))}
    </div>
  );
}
