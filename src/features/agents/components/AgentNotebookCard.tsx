import { BookOpen } from "lucide-react";
import { useState } from "react";
import type { AgentNotebook } from "@/features/ai-surface/types";
import { MistyMarkdown } from "@/features/ai-surface/MistyMarkdown";
import { Pressable } from "@/shared/ui";

/**
 * The run's notebook: its plan and the findings it and its sub-agents wrote,
 * open by default so the person can follow a long task as it works.
 */
export function AgentNotebookCard({ notebook }: { notebook: AgentNotebook }) {
  const [open, setOpen] = useState(true);
  const plan = notebook.plan.trim();
  const findings = notebook.findings.trim();
  if (!plan && !findings) return null;
  return (
    <section
      aria-label="Notebook"
      className="mt-3 rounded-lg border border-charcoal-border bg-charcoal-card p-3"
    >
      <Pressable
        className="flex w-full items-center gap-2"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <BookOpen className="size-3.5 shrink-0 text-cream-muted" aria-hidden="true" />
        <strong className="text-xs text-cream-bright">Notebook</strong>
        <span className="ml-auto text-[11px] text-cream-muted">{open ? "Hide" : "Show"}</span>
      </Pressable>
      {open ? (
        <div className="mt-2 grid gap-3">
          {plan ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-cream-muted">
                Plan
              </p>
              <div className="misty-markdown-message text-[13px] leading-5 text-cream">
                <MistyMarkdown>{plan}</MistyMarkdown>
              </div>
            </div>
          ) : null}
          {findings ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-cream-muted">
                Findings
              </p>
              <div className="misty-markdown-message text-[13px] leading-5 text-cream">
                <MistyMarkdown>{findings}</MistyMarkdown>
              </div>
            </div>
          ) : null}
          {notebook.noteId ? (
            <p className="text-[11px] text-cream-muted">
              Also saved as a note in your personal Space.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
