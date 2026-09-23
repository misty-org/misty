import { betaExecutionMode, visibleAutopilotAvailable } from "./betaModes";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui";
import { useEffect } from "react";
import { observeAccountChanges } from "@/api/accountEvents";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import { finishLocalExecution, isAgentWorkerWindow, useLocalExecution } from "./localExecution";
import { hasTauriInternals } from "@/shared/platform/tauri";

export function AgentChatControls({
  accountId,
  compact = false,
}: {
  accountId: string;
  compact?: boolean;
}) {
  const agents = usePersonalAgentsStore((s) => s.agents);
  const load = usePersonalAgentsStore((s) => s.load);
  const selected = useMistyStore((s) => s.selectedAgentId);
  const executionModeByAgent = useMistyStore((s) => s.executionModeByAgent);
  const globalMode = useMistyStore((s) => s.executionMode ?? "user");
  const execution = useLocalExecution((s) => s.execution);
  const working = useMistyStore((s) => s.working);
  const selectedSpaceId = useMistyStore((s) => s.selectedSpaceId);
  const conversationSpaceId = useMistyStore(
    (s) => s.conversations.find((c) => c.id === s.activeConversationId)?.spaceId,
  );
  const spaceId = execution?.spaceId || conversationSpaceId || selectedSpaceId || "";
  useEffect(() => {
    if (!accountId) {
      void load("");
      return;
    }
    return observeAccountChanges(accountId, ["agents"], () => load(accountId));
  }, [accountId, load]);
  const effective = agents.find((a) => a.id === selected) ?? agents.find((a) => a.system_managed);
  const currentAgentId = effective?.id ?? "misty";
  const mode = betaExecutionMode(
    (effective?.id ? executionModeByAgent?.[effective.id] : undefined) ?? globalMode,
  );
  const local = hasTauriInternals() && /Mac|Win/.test(navigator.platform);
  if (compact) {
    const enabledAgents = agents.filter((agent) => agent.enabled);
    return (
      <div className="space-y-1">
        <div className="flex min-h-10 items-center justify-between gap-4">
          <span className="text-cream-muted">Agent</span>
          {enabledAgents.length > 1 ? (
            <Select
              value={effective?.id ?? ""}
              disabled={working || !!execution}
              onValueChange={(agentId) => {
                const agentMode =
                  useMistyStore.getState().executionModeByAgent?.[agentId] ?? "user";
                usePersonalAgentsStore.getState().select(spaceId, agentId);
                useMistyStore.setState({
                  selectedAgentId: agentId,
                  executionMode: agentMode,
                  activeConversationId: "",
                  context: [],
                  handoff: undefined,
                });
              }}
            >
              <SelectTrigger aria-label="Agent" className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent data-misty-layer-portal>
                {enabledAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-cream">{effective?.name ?? "Misty"}</span>
          )}
        </div>
        {visibleAutopilotAvailable() ? (
          <p className="pb-2 text-xs leading-5 text-cream-muted">
            Misty can use this window. Pause or stop at any time.
          </p>
        ) : (
          <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 pb-2">
            <span className="text-cream-muted">Mode</span>
            <div className="flex items-center gap-1" role="group" aria-label="Execution mode">
              {(["user", "agent", "team"] as const).map((value) => (
                <Button
                  key={value}
                  size="xs"
                  variant={mode === value ? "default" : "ghost"}
                  aria-pressed={mode === value}
                  disabled={working || isAgentWorkerWindow() || (value !== "user" && !local)}
                  onClick={() => {
                    void finishLocalExecution().then(() =>
                      useMistyStore.setState((prev) => ({
                        executionMode: value,
                        executionModeByAgent: {
                          ...prev.executionModeByAgent,
                          [currentAgentId]: value,
                        },
                      })),
                    );
                  }}
                >
                  {value === "user" ? "Chat" : value === "agent" ? "Agent" : "Team"}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
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
            const agentId = event.target.value;
            const agentMode = useMistyStore.getState().executionModeByAgent?.[agentId] ?? "user";
            usePersonalAgentsStore.getState().select(spaceId, agentId);
            useMistyStore.setState({
              selectedAgentId: agentId,
              executionMode: agentMode,
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
            const next = betaExecutionMode(event.target.value as "user" | "agent" | "team");
            void finishLocalExecution().then(() =>
              useMistyStore.setState((prev) => ({
                executionMode: next,
                executionModeByAgent: {
                  ...prev.executionModeByAgent,
                  [currentAgentId]: next,
                },
              })),
            );
          }}
        >
          <option value="user" disabled={visibleAutopilotAvailable()}>
            User
          </option>
          <option value="agent" disabled={!local}>
            Agent
          </option>
          <option value="team" disabled={!local || visibleAutopilotAvailable()}>
            Team
          </option>
        </select>
      </label>
      <p className={compact ? "min-w-0 truncate text-cream-muted" : "w-full text-cream-muted"}>
        {spaceId ? "Historical conversation" : "Working in this workspace"}
      </p>
      <p className={compact ? "sr-only" : "w-full text-cream-muted"}>
        {mode === "user"
          ? "Discuss and draft. You control the workspace."
          : mode === "agent"
            ? "The agent will control this Misty window during its task."
            : "The agent will work in its own Misty window."}
      </p>
    </div>
  );
}
