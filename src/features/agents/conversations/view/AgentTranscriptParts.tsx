import { AgentAvatar } from "../../personal/AgentAvatar";
import { usePersonalAgentsStore } from "../../personal/personalAgentsStore";
import { useMistyStore } from "../state/useMistyStore";
import { useState } from "react";
import type { GlobalAiMessage } from "../state/conversationTypes";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { Button, cn } from "@/shared/ui";
import { AgentProgress } from "../../progress/AgentProgress";
import { useMessageProgress } from "../../progress/useMessageProgress";
import { visibleConversationContent } from "./conversationTurns";

/**
 * An earlier reply in the same turn, such as "Got it, starting…" before a long
 * task: its own work, then what it said, shown in line before the answer.
 */
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
        <div className="agent-progress-note misty-markdown-message">
          <MistyMarkdown>{content}</MistyMarkdown>
        </div>
      ) : null}
    </>
  );
}

/** Where the conversation Misty sees as notes ends and the verbatim part begins. */
export function SummarizedDivider() {
  return (
    <div
      role="separator"
      aria-label="Earlier messages summarized"
      title="Misty keeps the messages above as summarized notes to stay within its context."
      className="flex items-center gap-3 text-2xs text-cream-muted"
    >
      <span aria-hidden className="h-px flex-1 bg-charcoal-border" />
      <span>Earlier messages summarized</span>
      <span aria-hidden className="h-px flex-1 bg-charcoal-border" />
    </div>
  );
}

/** Who is answering, beside its reply: the engine's own mark, an initial, or a plain cloud for
 * Misty. Nothing sits behind it, and the animated cloud stays with the companion. */
export function MistyAvatar() {
  const agentId = useMistyStore((state) => state.selectedAgentId);
  const agent = usePersonalAgentsStore((state) =>
    state.agents.find((entry) => entry.id === agentId),
  );
  return (
    <span className="grid size-7 shrink-0 place-items-center text-cream">
      <AgentAvatar agent={agent} compact />
    </span>
  );
}

export function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 1200 || text.split("\n").length > 14;
  return (
    <>
      <p
        className={cn(
          "m-0 whitespace-pre-wrap break-words",
          long && !expanded && "line-clamp-[12]",
        )}
      >
        {text}
      </p>
      {long ? (
        <Button
          variant="quiet"

          className="mt-2 text-xs font-medium text-cream-muted hover:text-cream"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </>
  );
}
