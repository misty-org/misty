import { useEffect, useRef } from "react";
import { Pencil, X } from "lucide-react";
import { IconButton } from "@/shared/ui";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { useEngineQueue } from "./engineQueue";

/**
 * The messages waiting for the engine's turn to end, as chips above the composer: edit one (it
 * goes back into the composer) or remove it. When the turn ends the oldest is sent.
 */
export function EngineQueueChips(props: {
  conversationId?: string;
  working: boolean;
  onEdit: (text: string) => void;
  onSend: (text: string) => void;
}) {
  const queued = useEngineQueue((state) =>
    props.conversationId ? state.byConversation[props.conversationId] : undefined,
  );
  const wasWorking = useRef(props.working);
  const send = useStableCallback(props.onSend);
  useEffect(() => {
    const ended = wasWorking.current && !props.working;
    wasWorking.current = props.working;
    if (!ended || !props.conversationId) return;
    const next = useEngineQueue.getState().next(props.conversationId);
    if (next) send(next.text);
  }, [props.working, props.conversationId, send]);
  if (!queued?.length || !props.conversationId) return null;
  const conversationId = props.conversationId;
  return (
    <ul className="engine-queue" aria-label="Queued messages">
      {queued.map((message) => (
        <li key={message.id} className="engine-queue-chip">
          <span className="engine-queue-text">{message.text}</span>
          <IconButton
            label="Edit queued message"
            variant="toolbar"
            onClick={() => {
              useEngineQueue.getState().remove(conversationId, message.id);
              props.onEdit(message.text);
            }}
          >
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton
            label="Remove queued message"
            variant="toolbar"
            onClick={() => useEngineQueue.getState().remove(conversationId, message.id)}
          >
            <X className="size-3.5" />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}
