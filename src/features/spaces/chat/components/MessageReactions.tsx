import type { SpaceMessage } from "../../api/dto/entities";
import { FilterChip } from "@/shared/ui";

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
        <FilterChip
          size="sm"
          className="tabular-nums disabled:opacity-80"
          key={reaction.emoji}
          disabled={!canWrite}
          pressed={reaction.reacted_by_me === true}
          onPressedChange={() => onToggle(message, reaction.emoji, reaction.reacted_by_me === true)}
          label={`${reaction.emoji} ${reaction.count}`}
          aria-label={`${reaction.reacted_by_me ? "Remove" : "Add"} ${reaction.emoji} reaction`}
        />
      ))}
    </div>
  );
}
