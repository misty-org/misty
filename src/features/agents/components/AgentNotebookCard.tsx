import type { AgentNotebook } from "@/features/ai-surface/types";
import { MistyMarkdown } from "@/features/ai-surface/MistyMarkdown";
import { StatusRow, StatusTable } from "../progress/StatusTable";
import { WorkGroup } from "../progress/WorkGroup";

/**
 * The run's notebook: the findings it and its sub-agents wrote, a group line
 * that is open from the start so the person can follow a long task as it works.
 * The agent's own checklist stays out of it; people see a plan only in Plan mode.
 */
export function AgentNotebookCard({ notebook }: { notebook: AgentNotebook }) {
  const findings = notebook.findings.trim();
  if (!findings) return null;
  return (
    <WorkGroup summary="Notebook" running={false} openAtStart>
      <StatusTable label="Notebook">
        <StatusRow
          state="plain"
          sub={notebook.noteId ? "Also saved as a note in your personal Space." : undefined}
        >
          <div className="misty-markdown-message text-[13px] leading-5 text-cream">
            <MistyMarkdown>{findings}</MistyMarkdown>
          </div>
        </StatusRow>
      </StatusTable>
    </WorkGroup>
  );
}
