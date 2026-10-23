import type { MessageSpan } from "@/api/spaces/dto/common";
import type { SpaceMessage } from "@/api/spaces/dto/entities";
import { Badge } from "@/shared/ui";
import { Bot } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { formatChatMessageTime } from "./ChatDisplay";
import { isAgentAuthoredMessage } from "./messageHelpers";

/** The sender, an Agent badge when an agent wrote it, and the time. */
export function MessageHeader({ message }: { message: SpaceMessage }) {
  const agentAuthored = isAgentAuthoredMessage(message);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-5">
      <strong className="text-[15px] font-semibold text-cream">{message.sender_name}</strong>
      {agentAuthored ? (
        <Badge variant="secondary" className="h-4 gap-1 rounded px-1 text-[9px]">
          <Bot />
          Agent
        </Badge>
      ) : null}
      <time className="text-[11px] tabular-nums text-cream-muted">
        {formatChatMessageTime(message.created_at)}
      </time>
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
      <Link className="font-medium text-cream-bright underline underline-offset-2" to={span.url}>
        {span.label}
      </Link>
    );
  }
  return <span className={mentionClassName}>@{span.label}</span>;
}

const mentionClassName =
  "inline-flex items-center rounded-[3px] bg-mention-bg/35 px-1 py-0.5 font-medium text-cream-bright";
const plainMentionPattern = /(@[\p{L}\p{N}_.'’-]+(?:\s+[\p{Lu}][\p{L}\p{N}_.'’-]*){0,2})/gu;

/** Keeps older Agent messages legible before mentions were stored as structured spans. */
function PlainTextWithMentions({ text }: { text: string }) {
  return text.split(plainMentionPattern).map((part, index) =>
    part.startsWith("@") ? (
      <span key={index} className={mentionClassName}>
        {part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
