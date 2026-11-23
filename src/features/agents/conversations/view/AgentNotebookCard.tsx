import { Text } from "@misty/ui";
import type { AgentNotebook } from "../../runs/invocations/invocation_types";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { StatusRow, StatusTable } from "../../progress/StatusTable";
import { WorkGroup } from "../../progress/WorkGroup";

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
          <Text bare as="div" tone="default">
            <MistyMarkdown size="control">{findings}</MistyMarkdown>
          </Text>
        </StatusRow>
      </StatusTable>
    </WorkGroup>
  );
}
