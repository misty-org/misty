import { Fragment, memo, useMemo } from "react";
import { MistyActivityStatus } from "@/features/misty/MistyActivityStatus";
import type { GlobalAiConversation } from "@/features/misty/types";
import mistyCompanion from "@/shared/assets/misty-cloud-expression-cycle.webp?inline";
import type { LedgerRow } from "../checkpoints/ledger";
import { LessonObjectives } from "../lessons/LessonObjectives";
import { AgentMessage } from "./AgentMessage";
import { MistyAvatar, SummarizedDivider } from "./AgentTranscriptParts";
import { conversationTurns } from "./conversationTurns";

/** Memoized: typing in the composer must not re-render or re-parse the transcript. */
export const AgentConversationView = memo(function AgentConversationView(props: {
  conversation?: GlobalAiConversation;
  working: boolean;
  onRetry: (prompt: string, fromMessageId?: string) => void;
  /** Carries on from a ledger's open rows; `messageId` is the answer whose ledger it is. */
  onResume?: (messageId: string, rows: LedgerRow[], only?: string[]) => void;
  /** Saves a ledger the person changed (a skipped row). */
  onLedgerChange?: (messageId: string, rows: LedgerRow[]) => void;
  /** Puts an earlier prompt back in the composer. */
  onEdit?: (text: string) => void;
  /** Quotes an answer, or the part of it the person selected, into the composer. */
  onReply?: (quote: string) => void;
}) {
  const messages = props.conversation?.messages;
  const turns = useMemo(() => conversationTurns(messages ?? []), [messages]);
  if (!props.conversation?.messages.length) {
    return (
      <div className="grid min-h-full place-items-center px-8 py-20 text-center">
        <div className="max-w-sm">
          <span className="mx-auto grid size-14 place-items-center overflow-hidden rounded-full bg-blue-400/10 ring-1 ring-white/5">
            <img src={mistyCompanion} alt="" className="size-14 object-contain" draggable={false} />
          </span>
          <h3 className="mb-0 mt-5 text-lg font-semibold tracking-tight text-cream-bright">
            What can I help with?
          </h3>
          <p className="mb-0 mt-2 text-sm leading-relaxed text-cream-muted">
            Ask a question, create a drawing, update a task, or hand Misty a larger piece of work.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-transcript mx-auto w-full max-w-[760px] px-6 py-7 max-sm:px-4">
      <div className="space-y-7">
        <LessonObjectives conversationId={props.conversation.id} />
        {turns.map((turn) => {
          const handlers = {
            conversationId: props.conversation?.id,
            working: props.working,
            onRetry: props.onRetry,
            onResume: props.onResume,
            onLedgerChange: props.onLedgerChange,
            onEdit: props.onEdit,
            onReply: props.onReply,
          };
          return (
            <Fragment key={turn.key}>
              {turn.prompt && <AgentMessage message={turn.prompt} {...handlers} />}
              {turn.answer && (
                <AgentMessage
                  message={turn.answer}
                  steps={turn.steps}
                  retryPrompt={turn.prompt?.content}
                  retryFrom={turn.prompt?.id}
                  {...handlers}
                />
              )}
              {turn.compacted && <SummarizedDivider />}
            </Fragment>
          );
        })}
        {props.working &&
        !props.conversation.messages.some(
          (message) =>
            message.role === "assistant" &&
            (message.state === "pending" || message.state === "streaming"),
        ) ? (
          <div className="agent-message-assistant flex items-start gap-3.5">
            <MistyAvatar />
            <MistyActivityStatus />
          </div>
        ) : null}
      </div>
    </div>
  );
});
