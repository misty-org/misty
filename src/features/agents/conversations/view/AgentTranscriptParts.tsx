import { useState } from "react";
import type { GlobalAiMessage } from "../state/conversation_types";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { Button, OverflowFadeText, Separator, Text, Tooltip } from "@misty/ui";
import { AgentProgress } from "../../progress/AgentProgress";
import { useMessageProgress } from "../../progress/use_message_progress";
import { visibleConversationContent } from "./conversation_turns";

export function EarlierReply({ message }: { message: GlobalAiMessage }) {
  const progress = useMessageProgress(message);
  const content = visibleConversationContent(message.content, message.role);
  return (
    <>
      {progress?.length ? (
        <AgentProgress
          items={progress}
          live={message.state === "pending" || message.state === "streaming"}
        />
      ) : null}
      {content ? (
        <Text as="div" bare tone="default" className="w-full">
          <MistyMarkdown size="body">{content}</MistyMarkdown>
        </Text>
      ) : null}
    </>
  );
}

export function SummarizedDivider() {
  return (
    <Text
      bare
      as="div"
      tone="muted"
      role="separator"
      aria-label="Earlier messages summarized"
      size="caption"
      className="flex items-center gap-3"
    >
      <Separator className="flex-1" />
      <Tooltip content="Misty keeps the messages above as summarized notes to stay within its context.">
        <span>Earlier messages summarized</span>
      </Tooltip>
      <Separator className="flex-1" />
    </Text>
  );
}

export function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 1200 || text.split("\n").length > 14;
  return (
    <>
      {long && !expanded ? (
        <OverflowFadeText as="p" lines={12} className="m-0 whitespace-pre-wrap break-words">
          {text}
        </OverflowFadeText>
      ) : (
        <p className="m-0 whitespace-pre-wrap break-words">{text}</p>
      )}
      {long ? (
        <Button
          variant="quiet"

          className="mt-2 text-meta font-medium"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </>
  );
}
