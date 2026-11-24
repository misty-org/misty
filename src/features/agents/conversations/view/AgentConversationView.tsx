import { Fragment, memo, useMemo } from "react";
import { Text } from "@misty/ui";
import type { GlobalAiConversation } from "../state/conversation_types";
import type { LedgerRow } from "../../checkpoints/ledger";
import { LessonObjectives } from "../../tutor/lessons/LessonObjectives";
import { AgentMessage, AgentThinkingRow } from "./AgentMessage";
import { AgentWelcome } from "./AgentWelcome";
import type { AgentProfile } from "@/shared/schemas";
import { SummarizedDivider } from "./AgentTranscriptParts";
import { conversationTurns } from "./conversation_turns";

const transcriptClass = [
  "agent-transcript flex min-h-full w-full flex-col justify-end pt-4 pb-6",
  "[&_:is(p,li,a,pre)]:[overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto",
].join(" ");

export const AgentConversationView = memo(function AgentConversationView(props: {
  conversation?: GlobalAiConversation;
  agent?: AgentProfile;
  working: boolean;
  onRetry: (prompt: string, fromMessageId?: string) => void;
  onResume?: (messageId: string, rows: LedgerRow[], only?: string[]) => void;
  onLedgerChange?: (messageId: string, rows: LedgerRow[]) => void;
  onEdit?: (text: string) => void;
  onReply?: (quote: string) => void;
}) {
  const messages = props.conversation?.messages;
  const turns = useMemo(() => conversationTurns(messages ?? []), [messages]);
  if (!props.conversation?.messages.length) {
    return (
      <div className="grid min-h-full place-items-center px-8 py-20 text-center">
        <div className="max-w-sm">
          <Text
            weight="semibold"
            size="title"
            bare
            as="h3"
            tone="bright"
            className="m-0 tracking-tight"
          >
            What can I help with?
          </Text>
          <Text size="control" bare as="p" tone="muted" className="mb-0 mt-2 leading-relaxed">
            Ask a question, create a drawing, update a task, or hand Misty a larger piece of work.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className={transcriptClass}>
      {props.conversation.hasOlderMessages ? null : (
        <AgentWelcome
          agent={props.agent}
          line={`This is the beginning of this thread with ${props.agent?.name || "Misty"}.`}
        />
      )}
      <div className="flex flex-col">
        <div className="px-4 empty:hidden">
          <LessonObjectives conversationId={props.conversation.id} />
        </div>
        {turns.map((turn) => {
          const handlers = {
            conversationId: props.conversation?.id,
            agent: props.agent,
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
              {turn.compacted && (
                <div className="mt-4 px-4">
                  <SummarizedDivider />
                </div>
              )}
            </Fragment>
          );
        })}
        {props.working &&
        !props.conversation.messages.some(
          (message) =>
            message.role === "assistant" &&
            (message.state === "pending" || message.state === "streaming"),
        ) ? (
          <AgentThinkingRow
            agent={props.agent}
            since={[...props.conversation.messages].reverse().find((m) => m.role === "user")?.createdAt}
          />
        ) : null}
      </div>
    </div>
  );
});
