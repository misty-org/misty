import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { Flag } from "lucide-react";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { MistyMessageAttachments } from "../composer/MistyMessageAttachments";
import type { GlobalAiMessage } from "../state/conversation_types";
import { LinkPreviews } from "@/features/files";
import { MistyAppRequestCard } from "../state/MistyAppRequestCard";
import { ScreenRequestCard } from "../context/ScreenRequestCard";
import { Button, ChannelMessage, Text } from "@misty/ui";
import type { AgentProfile } from "@/shared/schemas";
import { AgentAvatar } from "../../personal/AgentAvatar";
import { messageStamp, useYou, YouFace } from "./AgentChatFaces";
import { splitLedger, type LedgerRow } from "../../checkpoints/ledger";
import { AgentAnsweredQuestions } from "../../plans/AgentAnsweredQuestions";
import { AgentMessageChecklist } from "../../plans/AgentChecklist";
import { AgentProgress } from "../../progress/AgentProgress";
import { continuationEvent } from "../../progress/continuation_event";
import { splitUnfinished } from "../../progress/unfinished";
import { useMessageProgress } from "../../progress/use_message_progress";
import { AgentMessageActions, replyDetails } from "./AgentMessageActions";
import { AgentNotebookCard } from "./AgentNotebookCard";
import { AgentRunOutcome } from "./AgentRunOutcome";
import { GrantCards } from "./grants/GrantCard";
import { AgentSubagents } from "./AgentSubagents";
import { EngineThinking } from "./engine/EngineThinking";
import { EngineAsks, useEngineTurn } from "./engine/EngineTurnParts";
import { EngineSubagents } from "./engine/EngineSubagents";
import { AgentTurnChanges } from "./AgentTurnChanges";
import { turnPhrase } from "../../progress/turn_model";
import { LiveStatus } from "./status/LiveStatus";
import { CollapsibleText, EarlierReply } from "./AgentTranscriptParts";
import { visibleConversationContent } from "./conversation_turns";
import { currentFailureWords, splitFailure } from "./failure_summary";
import { splitReplyQuote } from "./reply_quote";

type AgentMessageProps = {
  conversationId?: string;
  agent?: AgentProfile;
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
  const failed =
    ended && !remaining.length && message.state === "failed" ? splitFailure(visible) : undefined;
  const content = failed ? failed.answer : ended && !remaining.length ? "" : answer;
  const failure = failed ? failed.reason : "";
  const live = message.state === "pending" || message.state === "streaming";
  const engineTurn = useEngineTurn(
    message.role === "assistant" ? message.invocationId : undefined,
    live,
  );
  const thinking = engineTurn?.thinking.trim() ? engineTurn.thinking : (message.reasoning ?? "");
  const answering = engineTurn ? engineTurn.answering || engineTurn.ended || !live : true;
  const status = turnPhrase({
    progress,
    engine: engineTurn,
    writing: Boolean(content),
    waitingOnApp: message.appRequest?.state === "pending",
  });
  if (
    !content &&
    !ended &&
    !progress?.length &&
    !message.reasoning &&
    !message.appRequest &&
    !message.notebook &&
    !message.subagents?.length &&
    message.state !== "pending" &&
    message.state !== "streaming"
  )
    return null;
  if (message.role === "user") {
    if (message.source === "goal_continuation")
      return (
        <Text
          as="p"
          bare
          size="caption"
          tone="muted"
          className="mt-4 flex items-center justify-center gap-1.5"
        >
          <Flag aria-hidden="true" />
          Continued toward the goal
        </Text>
      );
    if (continuationEvent(content, message.source)) return null;
    const reply = splitReplyQuote(content);
    return <YouMessage {...props} content={content} reply={reply} />;
  }
  const stamp = messageStamp(message.createdAt);
  return (
    <ChannelMessage
      className="agent-message-assistant"
      data-state={message.state}
      data-message-id={message.id}
      avatar={<AgentAvatar agent={props.agent} />}
      name={props.agent?.name || "Misty"}
      time={stamp.time}
      timeFull={live ? stamp.full : replyDetails(message, stamp.full)}
      dateTime={message.createdAt}
      tools={
        live ? undefined : (
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
        )
      }
    >
      <div className="min-w-0 max-w-209">
        {props.steps?.map((step) => (
          <EarlierReply key={step.id} message={step} />
        ))}
        <AgentMessageChecklist
          conversationId={props.conversationId}
          invocationId={message.invocationId}
          running={live}
          hold={message.appRequest?.state === "pending" ? "waiting_for_you" : undefined}
        />
        {thinking ? <EngineThinking text={thinking} answering={answering} /> : null}
        {progress?.length ? <AgentProgress items={progress} live={live} /> : null}
        {engineTurn?.subagents.length ? (
          <EngineSubagents subagents={engineTurn.subagents} />
        ) : message.subagents?.length ? (
          <AgentSubagents subagents={message.subagents} />
        ) : null}
        {engineTurn && message.invocationId ? (
          <EngineAsks
            runId={message.invocationId}
            turn={engineTurn}
            conversationId={props.conversationId}
            onSend={(prompt) => props.onRetry(prompt)}
          />
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
        {message.notebook ? <AgentNotebookCard notebook={message.notebook} /> : null}
        {content ? (
          <Text bare as="div" tone="default" className="mt-3 first:mt-0">
            <MistyMarkdown size="body" streaming={live}>
              {content}
            </MistyMarkdown>
            <LinkPreviews text={content} enabled={!live} />
          </Text>
        ) : null}
        {live ? (
          <LiveStatus
            phrase={status.phrase}
            waiting={status.waiting}
            startedAt={message.createdAt}
            tokens={message.usage?.output}
          />
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
        {live ? null : <AgentTurnChanges progress={progress} />}
        {message.citations?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.citations.map((citation) => (
              <Button key={citation.id} asChild size="sm" className="font-normal">
                <Link to={citation.href}>{citation.title}</Link>
              </Button>
            ))}
          </div>
        ) : null}
        {props.conversationId ? (
          <AgentAnsweredQuestions
            conversationId={props.conversationId}
            invocationId={message.invocationId}
          />
        ) : null}
      </div>
    </ChannelMessage>
  );
}

function YouMessage(
  props: AgentMessageProps & { content: string; reply: ReturnType<typeof splitReplyQuote> },
) {
  const { message, reply } = props;
  const you = useYou();
  const stamp = messageStamp(message.createdAt);
  return (
    <ChannelMessage
      className="agent-message-user"
      data-message-id={message.id}
      data-anchor-id={message.id}
      avatar={<YouFace you={you} />}
      name={you.name}
      time={stamp.time}
      timeFull={stamp.full}
      dateTime={message.createdAt}
      tools={
        <AgentMessageActions
          conversationId={props.conversationId}
          message={message}
          text={props.content}
          working={props.working}
          resendable={props.content === message.content.trim() && !message.attachments?.length}
          onRetry={props.onRetry}
          onEdit={props.onEdit}
        />
      }
    >
      <Text bare as="div" size="body" tone="default" className="max-w-[72ch]">
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
    </ChannelMessage>
  );
}

export function AgentThinkingRow({ agent, since }: { agent?: AgentProfile; since?: string }) {
  const stamp = messageStamp(since ?? new Date().toISOString());
  return (
    <ChannelMessage
      className="agent-message-assistant"
      avatar={<AgentAvatar agent={agent} />}
      name={agent?.name || "Misty"}
      time={stamp.time}
      timeFull={stamp.full}
      dateTime={since ?? ""}
    >
      <LiveStatus phrase="Thinking" startedAt={since} />
    </ChannelMessage>
  );
}
