import { Button } from "@/shared/ui";
import { FileText, Presentation, Sheet, TextQuote } from "lucide-react";
import type { AgentCitation } from "./model/interfaces/types";
import { agentsOpenCitation } from "./store/useAgentsStore";

export function AgentSources({ citations, compact = false, onOpen }: AgentSourcesProps) {
  if (citations.length === 0) return null;
  const open = (citation: AgentCitation) => {
    if (onOpen) {
      void onOpen(citation);
      return;
    }
    void agentsOpenCitation({ citation }).catch(() => undefined);
  };
  return (
    <section className="mt-2 grid gap-1.5" aria-label="Sources">
      {!compact ? (
        <strong className="text-[10px] font-semibold capitalize text-cream-muted">Sources</strong>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {citations.map((citation, index) => {
          const Icon =
            citation.kind === "slide"
              ? Presentation
              : citation.kind === "sheet_range"
                ? Sheet
                : citation.kind === "section"
                  ? TextQuote
                  : FileText;
          return (
            <Button
              key={
                citation.id ||
                `${citation.scopeId}:${citation.relativePath || citation.fileName}:${citation.label}:${index}`
              }
              className="grid min-h-7 max-w-full grid-cols-[18px_14px_minmax(0,auto)_auto] items-center gap-1 rounded-md border border-charcoal-border bg-charcoal-card px-2 py-1 text-left text-[11px] text-cream-muted hover:border-charcoal-active hover:bg-charcoal-hover hover:text-cream"
              type="button"
              title={citation.excerpt ?? `${citation.fileName}, ${citation.label}`}
              onClick={() => open(citation)}
            >
              <span className="grid size-[18px] place-items-center rounded bg-sage-bg text-[9px] font-bold text-sage-fg">
                {index + 1}
              </span>
              <Icon size={13} aria-hidden="true" />
              <span className="truncate">{citation.fileName}</span>
              <span className="whitespace-nowrap text-cream-muted">{citation.label}</span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}

export interface AgentSourcesProps {
  citations: AgentCitation[];
  onOpen?: (citation: AgentCitation) => void | Promise<void>;
  compact?: boolean;
}
