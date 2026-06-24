import { useEffect } from "react";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import { useSpacesStore } from "@/features/spaces";
import { currentMistySpace } from "@/features/misty/availability";
import { finishLocalExecution, isAgentWorkerWindow, useLocalExecution } from "./localExecution";
import { hasTauriInternals } from "@/shared/platform/tauri";

export function AgentChatControls({ accountId }: { accountId: string }) {
  const agents = usePersonalAgentsStore((s) => s.agents);
  const load = usePersonalAgentsStore((s) => s.load);
  const selected = useMistyStore((s) => s.selectedAgentId);
  const mode = useMistyStore((s) => s.executionMode ?? "user");
  const execution = useLocalExecution((s) => s.execution);
  const working = useMistyStore((s) => s.working);
  const selectedSpaceId = useMistyStore((s) => s.selectedSpaceId);
  const conversationSpaceId = useMistyStore(
    (s) => s.conversations.find((c) => c.id === s.activeConversationId)?.spaceId,
  );
  const spaceId =
    execution?.spaceId || conversationSpaceId || selectedSpaceId || currentMistySpace();
  const spaceName = useSpacesStore((s) => s.spaces.find((space) => space.id === spaceId)?.name);
  useEffect(() => {
    void load(accountId);
  }, [accountId, load]);
  const effective = agents.find((a) => a.id === selected) ?? agents.find((a) => a.system_managed);
  const local = hasTauriInternals() && /Mac|Win/.test(navigator.platform);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-charcoal-border px-4 py-2 text-xs">
      <label className="flex items-center gap-2">
        Agent
        <select
          aria-label="Agent"
          className="max-w-48 rounded bg-charcoal-bg p-1.5 text-cream focus-visible:ring-2 focus-visible:ring-cream-muted"
          disabled={working || !!execution}
          value={effective?.id ?? ""}
          onChange={(event) => {
            usePersonalAgentsStore.getState().select(spaceId, event.target.value);
            useMistyStore.setState({
              selectedAgentId: event.target.value,
              activeConversationId: "",
              context: [],
              handoff: undefined,
            });
          }}
        >
          {!agents.length && <option value="">Misty</option>}
          {agents
            .filter((a) => a.enabled)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>
      <label className="ml-auto flex items-center gap-2">
        Mode
        <select
          aria-label="Execution mode"
          className="rounded bg-charcoal-bg p-1.5 text-cream focus-visible:ring-2 focus-visible:ring-cream-muted"
          disabled={working || isAgentWorkerWindow()}
          value={mode}
          onChange={(event) => {
            const next = event.target.value as "user" | "agent" | "team";
            void finishLocalExecution().then(() => useMistyStore.setState({ executionMode: next }));
          }}
        >
          <option value="user">User</option>
          <option value="agent" disabled={!local}>
            Agent
          </option>
          <option value="team" disabled={!local}>
            Team
          </option>
        </select>
      </label>
      <p className="w-full text-cream-muted">Working in {spaceName || "the selected Space"}</p>
      <p className="w-full text-cream-muted">
        {mode === "user"
          ? "Discuss and draft. You control the apps."
          : mode === "agent"
            ? "The agent will control this Misty window during its task."
            : "The agent will work in its own Misty window."}
      </p>
    </div>
  );
}
