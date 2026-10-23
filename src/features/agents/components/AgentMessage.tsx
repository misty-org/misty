import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Flag, Inbox } from "lucide-react";
import { MistyMarkdown } from "@/features/ai-surface/MistyMarkdown";
import { MistyActivityStatus } from "@/features/misty/MistyActivityStatus";
import { MistyMessageAttachments } from "@/features/misty/MistyMessageAttachments";
import type { GlobalAiMessage } from "@/features/misty/types";
import { LinkPreviews } from "@/features/link-preview/LinkPreviews";
import { MistyAppRequestCard } from "@/features/misty/MistyAppRequestCard";
import { ScreenRequestCard } from "@/features/misty/ScreenRequestCard";
import { Button, cn } from "@/shared/ui";
import { splitLedger, type LedgerRow } from "../checkpoints/ledger";
import { AgentAnsweredQuestions } from "../collaboration/AgentAnsweredQuestions";
import { AgentMessageChecklist } from "../collaboration/AgentChecklist";
import { AgentProgress } from "../progress/AgentProgress";
import { continuationEvent } from "../progress/continuationEvent";
import { splitUnfinished } from "../progress/unfinished";
import { useMessageProgress } from "../progress/useMessageProgress";
import { AgentMessageActions } from "./AgentMessageActions";
import { AgentNotebookCard } from "./AgentNotebookCard";
import { AgentRunOutcome } from "./AgentRunOutcome";
import { AgentSubagents } from "./AgentSubagents";
import { CollapsibleText, EarlierReply, MistyAvatar } from "./AgentTranscriptParts";
import { AnswerChanges } from "./changes/AnswerChanges";
import { visibleConversationContent } from "./conversationTurns";
import { splitFailure } from "./failureSummary";
import { splitReplyQuote } from "./replyQuote";

type AgentMessageProps = {
  conversationId?: string;
  message: GlobalAiMessage;
  steps?: GlobalAiMessage[];
  retryPrompt?: string;
  retryFrom?: string;
  working: boolean;
  onRetry: (prompt: string, fromMessageId?: string) => void;
  onResume?: (messageId: string, rows: LedgerRow[], only?: string[]) => void;
  onLedgerChange?: (messageId: string, rows: LedgerRow[]) => void;
  onEdit?: (text: string) => void;
  onReply?: (quote: string) => void;
};

/**
 * Message objects keep their identity until patched, so while an answer streams only that
 * message re-renders and re-parses its Markdown. Steps are rebuilt per render; compare items.
 */
export const AgentMessage = memo(AgentMessageView, (previous, next) => {
  const { steps: previousSteps, ...previousRest } = previous;
  const { steps: nextSteps, ...nextRest } = next;
  const keys = Object.keys(nextRest) as (keyof typeof nextRest)[];
  return (
    keys.length === Object.keys(previousRest).length &&
    keys.every((key) => previousRest[key] === nextRest[key]) &&
    (previousSteps?.length ?? 0) === (nextSteps?.length ?? 0) &&
    (nextSteps ?? []).every((step, index) => previousSteps?.[index] === step)
  );
});

function AgentMessageView(props: AgentMessageProps) {
  const message = props.message;
  const progress = useMessageProgress(message);
  const visible = visibleConversationContent(message.content, message.role);
  const ledger = useMemo(
    () => (message.role === "assistant" ? splitLedger(message.content).rows : []),
    [message.content, message.role],
  );
  const ended =
    message.role === "assistant" && (message.state === "failed" || message.state === "canceled");
  const { answer, remaining } = ended
    ? splitUnfinished(visible)
    : { answer: visible, remaining: [] };
  // A failed run's answer stays the answer; only the short reason it stopped goes in its table
  // row (failureSummary.ts), since nobody reads a whole answer inside a failure card.
  const failed =
    ended && !remaining.length && message.state === "failed" ? splitFailure(visible) : undefined;
  const content = failed ? failed.answer : ended && !remaining.length ? "" : answer;
  const failure = failed ? failed.reason : "";
  if (
    !content &&
    !ended &&
    !message.appRequest &&
    !message.notebook &&
    !message.subagents?.length &&
    message.state !== "pending" &&
    message.state !== "streaming"
  )
    return null;
  if (message.role === "user") {
    // Misty started this turn itself to keep working toward the goal.
    if (message.source === "goal_continuation")
      return (
        <p className="agent-goal-continuation">
          <Flag size={13} aria-hidden="true" />
          Continued toward the goal
        </p>
      );
    // A turn Misty sent itself after a card was answered has no line of its own: the checklist
    // above it already shows what it is doing next.
    if (continuationEvent(content, message.source)) return null;
    const reply = splitReplyQuote(content);
    return (
      <div className="agent-message-user group/message flex flex-col items-end gap-1.5">
        {message.source === "scheduled_task" ? (
          <span className="flex items-center gap-1.5 text-xs text-cream-muted">
            <CalendarClock size={13} aria-hidden="true" />
            Sent by scheduled task
          </span>
        ) : message.source === "inbound_task" ? (
          <span className="flex items-center gap-1.5 text-xs text-cream-muted">
            <Inbox size={13} aria-hidden="true" />
            Sent from email or Slack
          </span>
        ) : null}
        <div
          className={cn(
            "max-w-[82%] rounded-2xl rounded-br-md border border-white/5 bg-charcoal-card",
            "px-4 py-3 text-[14px] leading-6 text-cream shadow-sm",
          )}
        >
          <MistyMessageAttachments attachments={message.attachments} />
          {reply.quote ? (
            <blockquote className="agent-message-quote">{reply.quote}</blockquote>
          ) : null}
          <CollapsibleText text={reply.body} />
        </div>
        <AgentMessageActions
          message={message}
          text={content}
          working={props.working}
          resendable={content === message.content.trim() && !message.attachments?.length}
          onRetry={props.onRetry}
          onEdit={props.onEdit}
        />
      </div>
    );
  }
  return (
    <article
      className="agent-message-assistant group/message flex items-start gap-3.5"
      data-state={message.state}
    >
      <MistyAvatar />
      <div className="min-w-0 flex-1">
        {props.steps?.map((step) => (
          <EarlierReply key={step.id} message={step} />
        ))}
        <AgentMessageChecklist
          conversationId={props.conversationId}
          invocationId={message.invocationId}
          running={message.state === "pending" || message.state === "streaming"}
          hold={message.appRequest?.state === "pending" ? "waiting_for_you" : undefined}
        />
        {progress?.length ? (
          <AgentProgress
            items={progress}
            live={message.state === "pending" || message.state === "streaming"}
          />
        ) : null}
        {message.subagents?.length ? <AgentSubagents subagents={message.subagents} /> : null}
        {message.notebook ? <AgentNotebookCard notebook={message.notebook} /> : null}
        {content ? (
          <div className="misty-markdown-message text-[14px] leading-6 text-cream">
            <MistyMarkdown>{content}</MistyMarkdown>
            <LinkPreviews
              text={content}
              enabled={message.state !== "pending" && message.state !== "streaming"}
            />
          </div>
        ) : (message.state === "pending" || message.state === "streaming") &&
          // A running tool's row already says what Misty is doing.
          !progress?.some((item) => item.type === "tool" && item.state === "running") ? (
          <div className="agent-message-status">
            <MistyActivityStatus activity={message.activity} />
          </div>
        ) : null}
        {ended ? (
          <AgentRunOutcome
            message={message}
            remaining={remaining}
            failure={failure}
            retryPrompt={props.retryPrompt}
            retryFrom={props.retryFrom}
            working={props.working}
            onRetry={props.onRetry}
            ledger={ledger}
            conversationId={props.conversationId}
            onResume={props.onResume && ((rows, only) => props.onResume?.(message.id, rows, only))}
            onLedgerChange={
              props.onLedgerChange && ((rows) => props.onLedgerChange?.(message.id, rows))
            }
          />
        ) : null}
        <AnswerChanges message={message} conversationId={props.conversationId} />
        {message.citations?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.citations.map((citation) => (
              <Button key={citation.id} asChild variant="chip" size="chip" className="font-normal">
                <Link to={citation.href}>{citation.title}</Link>
              </Button>
            ))}
          </div>
        ) : null}
        {message.appRequest ? (
          <MistyAppRequestCard messageId={message.id} request={message.appRequest} />
        ) : null}
        {message.screenRequest ? (
          <ScreenRequestCard messageId={message.id} request={message.screenRequest} />
        ) : null}
        {props.conversationId ? (
          <AgentAnsweredQuestions
            conversationId={props.conversationId}
            invocationId={message.invocationId}
          />
        ) : null}
        <AgentMessageActions
          message={message}
          text={content}
          working={props.working}
          retryPrompt={props.retryPrompt}
          retryFrom={props.retryFrom}
          onRetry={props.onRetry}
          onReply={props.onReply}
        />
      </div>
    </article>
  );
}
