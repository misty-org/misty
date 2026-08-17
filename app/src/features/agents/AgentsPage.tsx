import { AgentEmptyState } from "./components/AgentEmptyState";
import { AgentEditorPanel } from "./components/AgentEditorPanel";
import { AgentSpacesRail } from "./components/AgentSpacesRail";
import { PersonalAgentsSidebar } from "./components/PersonalAgentsSidebar";
import { useAgentEditor } from "./useAgentEditor";

export default function DesktopAgentsPage() {
  const editor = useAgentEditor();
  const editing = Boolean(editor.editing);

  const gridClass = editing
    ? "grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] overflow-hidden max-[800px]:grid-cols-1"
    : "grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)_260px] overflow-hidden max-[1100px]:grid-cols-[320px_minmax(0,1fr)] max-[800px]:grid-cols-1";

  return (
    <main className={gridClass}>
      <aside className="flex min-h-0 flex-col border-r border-charcoal-border bg-charcoal-sidebar p-4">
        <PersonalAgentsSidebar
          selectedAgentId={editor.editingAgentId}
          onSelect={editor.open}
          onCreate={() => editor.open("new")}
          onDelete={(agentId) => void editor.deleteAgent(agentId)}
        />
      </aside>
      {editing ? (
        <AgentEditorPanel editor={editor} />
      ) : (
        <>
          <AgentEmptyState onCreate={() => editor.open("new")} />
          <div className="h-full min-h-0 max-[1100px]:hidden">
            <AgentSpacesRail />
          </div>
        </>
      )}
    </main>
  );
}
