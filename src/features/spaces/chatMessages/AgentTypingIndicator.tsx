import { useState } from "react";
import { Bot, Square } from "lucide-react";
import { Avatar, AvatarFallback, Button } from "@/ui";
import { avatarInkClass, robotAvatarClass } from "@/lib/avatarPalette";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";

const dotClass = "size-1.5 rounded-full bg-avatar-aqua motion-safe:animate-bounce";

export interface AgentTypingIndicatorProps {
  /** Present once the run exists; without it there is nothing to cancel yet. */
  runId?: string;
}

/**
 * The "an Agent is composing a reply" bubble at the end of the thread.
 *
 * It stands in for the inline run card while a run is simply in flight, so the
 * ordinary path reads like a chat instead of a status report. The card comes
 * back for states that need a decision — approval, failure, cancellation.
 */
export function AgentTypingIndicator({ runId }: AgentTypingIndicatorProps) {
  const [canceling, setCanceling] = useState(false);

  return (
    <article
      className="group mt-4 grid grid-cols-[44px_minmax(0,1fr)] gap-x-4 rounded-xl px-3 py-1"
      role="status"
      aria-label="Agent is responding"
    >
      <div className="col-start-1 flex justify-end">
        <Avatar className="mt-0.5 size-10">
          <AvatarFallback className={`text-xs font-semibold ${robotAvatarClass} ${avatarInkClass}`}>
            <Bot className="size-4" strokeWidth={2} />
          </AvatarFallback>
        </Avatar>
      </div>
      <div className="col-start-2 flex min-w-0 items-center gap-2">
        <span className="sr-only">Agent is responding</span>
        <span className="flex h-9 items-center gap-1.5 rounded-2xl bg-charcoal-card px-4">
          <span className={`${dotClass} [animation-delay:-300ms]`} />
          <span className={`${dotClass} [animation-delay:-150ms]`} />
          <span className={dotClass} />
        </span>
        {runId ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-cream-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            disabled={canceling}
            onClick={() => {
              setCanceling(true);
              void spacesApi.cancelRun(runId).catch(() => setCanceling(false));
            }}
          >
            <Square className="size-3" /> Cancel
          </Button>
        ) : null}
      </div>
    </article>
  );
}
