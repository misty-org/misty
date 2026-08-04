import { Bot } from "lucide-react";
import { PersonalAgentsSidebar } from "./PersonalAgentsSidebar";
import { AgentEditorPanel } from "./AgentEditorPanel";
import { useAgentEditor } from "./useAgentEditor";

export default function DesktopAgentsPage() {
  const editor = useAgentEditor();

  return (
    <main className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] overflow-hidden max-[800px]:grid-cols-1">
      <aside className="flex min-h-0 flex-col border-r border-border bg-[var(--misty-app-panel-bg,transparent)] p-4">
        <PersonalAgentsSidebar
          selectedAgentId={editor.editingAgentId}
          onSelect={editor.open}
          onCreate={() => editor.open("new")}
          onDelete={(agentId) => void editor.deleteAgent(agentId)}
        />
      </aside>
      {editor.editing ? (
        <AgentEditorPanel editor={editor} />
      ) : (
        <section className="grid min-h-0 place-items-center p-8 text-center max-[800px]:hidden">
          <div className="max-w-md">
            <span className="mx-auto mb-4 grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
              <Bot size={21} />
            </span>
            <h1 className="m-0 text-lg font-semibold">Manage your Agents</h1>
            <p className="mb-0 mt-2 text-sm leading-6 text-muted-foreground">
              Select an Agent to edit its instructions and capabilities, or create a new one.
              Conversations with Agents happen inside each Space.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
