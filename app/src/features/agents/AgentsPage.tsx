import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AgentActivityPanel } from "./components/AgentActivityPanel";
import { AgentEditorPanel } from "./components/AgentEditorPanel";
import { AgentEmptyState } from "./components/AgentEmptyState";
import { AgentSpacesRail } from "./components/AgentSpacesRail";
import { PersonalAgentsSidebar } from "./components/PersonalAgentsSidebar";
import { usePersonalAgentsStore } from "./store/usePersonalAgentsStore";
import { useAgentActivity } from "./useAgentActivity";
import { useAgentEditor } from "./useAgentEditor";

export default function DesktopAgentsPage() {
  const editor = useAgentEditor();
  const agents = usePersonalAgentsStore(useShallow((state) => state.agents));
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );
  const activity = useAgentActivity(selectedAgent?.id ?? "");
  const editing = Boolean(editor.editing);

  useEffect(() => {
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(agents[0]?.id ?? "");
  }, [agents, selectedAgentId]);

  const gridClass = editing
    ? "grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] overflow-hidden max-[800px]:grid-cols-1"
    : "grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)_260px] overflow-hidden max-[1100px]:grid-cols-[320px_minmax(0,1fr)] max-[800px]:grid-cols-1";

  return (
    <main className={gridClass}>
      <aside className="flex min-h-0 flex-col border-r border-charcoal-border bg-charcoal-sidebar p-4">
        <PersonalAgentsSidebar
          selectedAgentId={selectedAgentId}
          onSelect={(agent) => {
            editor.close();
            setSelectedAgentId(agent.id);
          }}
          onEdit={editor.open}
          onCreate={() => editor.open("new")}
          onDelete={(agentId) => void editor.deleteAgent(agentId)}
        />
      </aside>
      {editing ? (
        <AgentEditorPanel editor={editor} />
      ) : (
        <>
          {selectedAgent ? (
            <AgentActivityPanel
              agent={selectedAgent}
              controller={activity}
              onEdit={() => editor.open(selectedAgent)}
            />
          ) : (
            <AgentEmptyState onCreate={() => editor.open("new")} />
          )}
          <div className="h-full min-h-0 max-[1100px]:hidden">
            <AgentSpacesRail activity={activity.activity} />
          </div>
        </>
      )}
    </main>
  );
}
