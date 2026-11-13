import { Fragment, memo, useMemo } from "react";
import { Text } from "@/shared/ui";
import { MistyActivityStatus } from "../state/MistyActivityStatus";
import type { GlobalAiConversation } from "../state/conversationTypes";
import type { LedgerRow } from "../../checkpoints/ledger";
import { LessonObjectives } from "../../tutor/lessons/LessonObjectives";
import { AgentMessage } from "./AgentMessage";
import { SummarizedDivider } from "./AgentTranscriptParts";
import { conversationTurns } from "./conversationTurns";

/** The transcript column; long words and code wrap or scroll inside it instead of widening it. */
const transcriptClass = [
  "agent-transcript mx-auto w-full max-w-209 px-6 py-7",
  "[&_:is(p,li,a,pre)]:[overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto",
].join(" ");

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
          <Text bare as="h3" tone="bright" className="m-0 text-lg font-semibold tracking-tight">
            What can I help with?
          </Text>
          <Text bare as="p" tone="muted" className="mb-0 mt-2 text-sm leading-relaxed">
            Ask a question, create a drawing, update a task, or hand Misty a larger piece of work.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className={transcriptClass}>
      <div className="flex flex-col gap-4.5 [&>*]:my-0!">
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
          <div className="agent-message-assistant flex items-start [&>*]:min-w-0 [&>*]:flex-1">
            <MistyActivityStatus />
          </div>
        ) : null}
      </div>
    </div>
  );
});
