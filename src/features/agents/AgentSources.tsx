import type { AgentSourcesProps } from "@/models/interfaces/features/agents/AgentSources";
export type { AgentSourcesProps } from "@/models/interfaces/features/agents/AgentSources";
import { Button } from "@/ui";
import { FileText, Presentation, Sheet, TextQuote } from "lucide-react";
import { agentsOpenCitation } from "@/stores/agents/useAgentsStore";
import type { AgentCitation } from "@/models/interfaces/features/agents/types";

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
    <section className={`agent-sources${compact ? " is-compact" : ""}`} aria-label="Sources">
      <strong className="agent-sources-title">Sources</strong>
      <div className="agent-sources-list">
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
              className="agent-source"
              type="button"
              title={citation.excerpt ?? `${citation.fileName}, ${citation.label}`}
              onClick={() => open(citation)}
            >
              <span className="agent-source-index">{index + 1}</span>
              <Icon size={13} aria-hidden="true" />
              <span className="agent-source-name">{citation.fileName}</span>
              <span className="agent-source-location">{citation.label}</span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
