import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceStore } from "@/features/workspace";
import { AgentConversationPanel } from "./components/AgentConversationPanel";
import { AgentEditorPanel } from "./components/AgentEditorPanel";
import { AgentEmptyState } from "./components/AgentEmptyState";
import { PersonalAgentsSidebar } from "./components/PersonalAgentsSidebar";
import { resolveAgentSpaceId } from "./agentSpaceSelection";
import { usePersonalAgentsStore } from "./store/usePersonalAgentsStore";
import { useAgentActivity } from "./useAgentActivity";
import { useAgentEditor } from "./useAgentEditor";

export default function DesktopAgentsPage() {
  const editor = useAgentEditor();
  const [searchParams, setSearchParams] = useSearchParams();
  const agents = usePersonalAgentsStore(useShallow((state) => state.agents));
  const spaces = useSpacesStore((state) => state.spaces);
  const loadSpaces = useSpacesStore((state) => state.load);
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const [selectedAgentId, setSelectedAgentId] = useState(() => searchParams.get("agent") ?? "");
  const [spaceId, setSpaceId] = useState(() => searchParams.get("space") ?? "");
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

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  useEffect(() => {
    if (spaceId && spaces.some((space) => space.id === spaceId)) return;
    setSpaceId(resolveAgentSpaceId(spaces, activeScopeKey));
  }, [activeScopeKey, spaceId, spaces]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedAgentId) next.set("agent", selectedAgentId);
    else next.delete("agent");
    if (spaceId) next.set("space", spaceId);
    else next.delete("space");
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [searchParams, selectedAgentId, setSearchParams, spaceId]);

  const gridClass =
    "grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)] overflow-hidden max-[700px]:grid-cols-[190px_minmax(0,1fr)]";

  return (
    <main className={gridClass}>
      <aside className="flex min-h-0 flex-col border-r border-charcoal-border bg-charcoal-sidebar p-3">
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
      ) : selectedAgent && spaceId ? (
        <AgentConversationPanel
          agent={selectedAgent}
          spaceId={spaceId}
          spaces={spaces}
          onSpaceChange={setSpaceId}
          onEdit={() => editor.open(selectedAgent)}
          controller={activity}
        />
      ) : (
        <AgentEmptyState onCreate={() => editor.open("new")} />
      )}
    </main>
  );
}
