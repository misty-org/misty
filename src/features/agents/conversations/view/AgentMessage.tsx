import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { Flag } from "lucide-react";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { MistyActivityStatus } from "../state/MistyActivityStatus";
import { MistyMessageAttachments } from "../composer/MistyMessageAttachments";
import type { GlobalAiMessage } from "../state/conversationTypes";
import { LinkPreviews } from "@/features/files";
import { MistyAppRequestCard } from "../state/MistyAppRequestCard";
import { ScreenRequestCard } from "../context/ScreenRequestCard";
import { Button, Surface, Text } from "@/shared/ui";
import { splitLedger, type LedgerRow } from "../../checkpoints/ledger";
import { AgentAnsweredQuestions } from "../../plans/AgentAnsweredQuestions";
import { AgentMessageChecklist } from "../../plans/AgentChecklist";
import { AgentProgress } from "../../progress/AgentProgress";
import { continuationEvent } from "../../progress/continuationEvent";
import { splitUnfinished } from "../../progress/unfinished";
import { useMessageProgress } from "../../progress/useMessageProgress";
import { AgentMessageActions } from "./AgentMessageActions";
import { AgentNotebookCard } from "./AgentNotebookCard";
import { AgentRunOutcome } from "./AgentRunOutcome";
import { GrantCards } from "./grants/GrantCard";
import { AgentSubagents } from "./AgentSubagents";
import { EngineTurnParts } from "./engine/EngineTurnParts";
import { CollapsibleText, EarlierReply } from "./AgentTranscriptParts";
import { visibleConversationContent } from "./conversationTurns";
import { currentFailureWords, splitFailure } from "./failureSummary";
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
  const shown = visibleConversationContent(message.content, message.role);
  const visible = message.state === "failed" ? currentFailureWords(shown) : shown;
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
        <Text
          as="p"
          bare
          size="caption"
          tone="muted"
          className="flex items-center justify-center gap-1.5"
        >
          <Flag aria-hidden="true" />
          Continued toward the goal
        </Text>
      );
    // A turn Misty sent itself after a card was answered has no line of its own: the checklist
    // above it already shows what it is doing next.
    if (continuationEvent(content, message.source)) return null;
    const reply = splitReplyQuote(content);
    return (
      <div
        className="agent-message-user group/message flex flex-col items-end gap-1.5"
        data-message
        data-message-id={message.id}
        data-anchor-id={message.id}
      >
        <Surface
          // One step above the card surface, which barely separates from the canvas.
          tone="well"
          radius="xl"
          className="max-w-[min(82%,72ch)] px-3.5 py-2.5 text-control leading-[1.6]"
        >
          <Text bare as="div" tone="default">
            <MistyMessageAttachments attachments={message.attachments} />
            {reply.quote ? (
              <blockquote className="m-0 mb-2 border-l-2 pl-2.5">
                <Text
                  as="p"
                  size="meta"
                  tone="muted"
                  lines={3}
                  className="max-h-[3lh] leading-normal whitespace-pre-wrap"
                >
                  {reply.quote}
                </Text>
              </blockquote>
            ) : null}
            <CollapsibleText text={reply.body} />
          </Text>
        </Surface>
        <AgentMessageActions
          conversationId={props.conversationId}
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
      className="agent-message-assistant group/message flex items-start"
      data-message
      data-state={message.state}
      data-message-id={message.id}
    >
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
        {message.invocationId ? (
          <EngineTurnParts
            runId={message.invocationId}
            live={message.state === "pending" || message.state === "streaming"}
            conversationId={props.conversationId}
            onSend={(prompt) => props.onRetry(prompt)}
          />
        ) : null}
        {progress?.length ? (
          <AgentProgress
            items={progress}
            live={message.state === "pending" || message.state === "streaming"}
          />
        ) : null}
        {message.subagents?.length ? <AgentSubagents subagents={message.subagents} /> : null}
        {message.notebook ? <AgentNotebookCard notebook={message.notebook} /> : null}
        {content ? (
          <Text bare as="div" tone="default" className="misty-markdown-message text-sm leading-6">
            <MistyMarkdown streaming={message.state === "pending" || message.state === "streaming"}>
              {content}
            </MistyMarkdown>
            <LinkPreviews
              text={content}
              enabled={message.state !== "pending" && message.state !== "streaming"}
            />
          </Text>
        ) : (message.state === "pending" || message.state === "streaming") &&
          // A running tool's row already says what Misty is doing.
          !progress?.some((item) => item.type === "tool" && item.state === "running") ? (
          // Status lines keep a control's height, so the reply doesn't jump when text arrives.
          <div className="flex min-h-8 items-center">
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
        {message.citations?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.citations.map((citation) => (
              <Button key={citation.id} asChild size="sm" className="font-normal">
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
        {message.folderGrants?.length ? (
          <GrantCards
            conversationId={props.conversationId}
            message={message}
            working={props.working}
            retryPrompt={props.retryPrompt}
            retryFrom={props.retryFrom}
            onRetry={props.onRetry}
          />
        ) : null}
        {props.conversationId ? (
          <AgentAnsweredQuestions
            conversationId={props.conversationId}
            invocationId={message.invocationId}
          />
        ) : null}
        <AgentMessageActions
          conversationId={props.conversationId}
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
