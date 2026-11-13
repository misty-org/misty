import { useEffect, useRef } from "react";
import { Clock, Pencil, X } from "lucide-react";
import { ComposerStatusRow, IconButton } from "@/shared/ui";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { useEngineQueue } from "./engineQueue";

/**
 * The messages waiting for the engine's turn to end, as rows at the top of the composer: edit one
 * (it goes back into the composer) or remove it. When the turn ends the oldest is sent. Render it
 * in the composer's `status` so it stays mounted to send them.
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
    <div role="list" aria-label="Queued messages" className="contents">
      {queued.map((message) => (
        <div key={message.id} role="listitem" className="contents">
          <ComposerStatusRow
            icon={Clock}
            label="Queued"
            actions={
              <>
                <IconButton
                  label="Edit queued message"
                  onClick={() => {
                    useEngineQueue.getState().remove(conversationId, message.id);
                    props.onEdit(message.text);
                  }}
                >
                  <Pencil />
                </IconButton>
                <IconButton
                  label="Remove queued message"
                  onClick={() => useEngineQueue.getState().remove(conversationId, message.id)}
                >
                  <X />
                </IconButton>
              </>
            }
          >
            {message.text}
          </ComposerStatusRow>
        </div>
      ))}
    </div>
  );
}
