import { useState } from "react";
import type { GlobalAiMessage } from "@/features/misty/types";
import { MistyMarkdown } from "@/features/ai-surface/MistyMarkdown";
import mistyCompanion from "@/shared/assets/misty-cloud-expression-cycle.webp?inline";
import { Button, cn } from "@/shared/ui";
import { AgentProgress } from "../progress/AgentProgress";
import { useMessageProgress } from "../progress/useMessageProgress";
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
      className="flex items-center gap-3 text-[11px] text-cream-muted"
    >
      <span aria-hidden className="h-px flex-1 bg-white/10" />
      <span>Earlier messages summarized</span>
      <span aria-hidden className="h-px flex-1 bg-white/10" />
    </div>
  );
}

export function MistyAvatar() {
  return (
    <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-400/10 ring-1 ring-white/5">
      <img src={mistyCompanion} alt="Misty" className="size-7 object-contain" draggable={false} />
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
          variant="ghost"

          className="mt-2 text-xs font-medium text-cream-muted hover:text-cream"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </>
  );
}
