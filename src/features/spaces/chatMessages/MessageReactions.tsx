import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";

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
        <button
          className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors ${
            reaction.reacted_by_me
              ? "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15"
              : "border-border/70 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
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
        </button>
      ))}
    </div>
  );
}
