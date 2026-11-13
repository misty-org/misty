import type { MessageSpan } from "../../api/dto/common";
import type { SpaceMessage } from "../../api/dto/entities";
import { Badge, Text } from "@/shared/ui";
import { AgentMark } from "@/features/agents";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { formatChatMessageTime } from "./ChatDisplay";
import { isAgentAuthoredMessage } from "./messageText";

/** The sender, an Agent badge when an agent wrote it, and the time. */
export function MessageHeader({ message }: { message: SpaceMessage }) {
  const agentAuthored = isAgentAuthoredMessage(message);
  return (
    <div className="flex min-w-0 items-center leading-5 gap-2">
      <Text bare as="strong" tone="default" weight="semibold" className="text-md">
        {message.sender_name}
      </Text>
      {agentAuthored ? (
        <Badge variant="secondary" className="h-4 gap-1 rounded px-1 text-3xs">
          <AgentMark agentId={message.sender_agent_id} />
          Agent
        </Badge>
      ) : null}
      <Text bare as="time" tone="muted" className="text-2xs tabular-nums">
        {formatChatMessageTime(message.created_at)}
      </Text>
    </div>
  );
}

/** The message's words and link addresses as one string, for finding links to preview. */
export function messageText(spans: MessageSpan[]): string {
  return spans
    .map((span) => (span.type === "text" ? span.text : span.type === "link" ? ` ${span.url} ` : ""))
    .join("");
}

export function MessageContent({
  span,
  highlightPlainMentions,
}: {
  span: MessageSpan;
  highlightPlainMentions: boolean;
}) {
  if (span.type === "text") {
    return highlightPlainMentions ? <PlainTextWithMentions text={span.text} /> : <>{span.text}</>;
  }
  if (span.type === "link") {
    return (
      <Text bare tone="bright">
        <Link className="font-medium underline underline-offset-2" to={span.url}>
          {span.label}
        </Link>
      </Text>
    );
  }
  return (
    <Text bare tone="bright" className={mentionClassName}>
      @{span.label}
    </Text>
  );
}

const mentionClassName =
  "inline-flex items-center rounded-[3px] bg-mention-bg/35 px-1 py-0.5 font-medium";
const plainMentionPattern = /(@[\p{L}\p{N}_.'’-]+(?:\s+[\p{Lu}][\p{L}\p{N}_.'’-]*){0,2})/gu;

/** Keeps older Agent messages legible before mentions were stored as structured spans. */
function PlainTextWithMentions({ text }: { text: string }) {
  return text.split(plainMentionPattern).map((part, index) =>
    part.startsWith("@") ? (
      <Text bare tone="bright" key={index} className={mentionClassName}>
        {part}
      </Text>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
