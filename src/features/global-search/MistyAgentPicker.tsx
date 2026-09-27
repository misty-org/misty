import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { observeAccountChanges } from "@/api/accountEvents";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  usePersonalAgentsStore,
  selectedPersonalAgent,
} from "@/features/agents/personalAgentsStore";
import { finishLocalExecution, useLocalExecution } from "@/features/agents/localExecution";
import { betaExecutionMode } from "@/features/agents/betaModes";
import { AgentAvatar } from "@/features/agents/AgentAvatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, MenuTrigger } from "@/shared/ui";

export function MistyAgentPicker({ accountId }: { accountId: string }) {
  const agents = usePersonalAgentsStore((state) => state.agents);
  const loading = usePersonalAgentsStore((state) => state.loading);
  const error = usePersonalAgentsStore((state) => state.error);
  const selected = useMistyStore((state) => state.selectedAgentId);
  const working = useMistyStore((state) => state.working);
  const execution = useLocalExecution((state) => state.execution);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    if (!accountId) return;
    return observeAccountChanges(accountId, ["agents"], () =>
      usePersonalAgentsStore.getState().load(accountId),
    );
  }, [accountId]);
  const current = agents.find((agent) => agent.id === selected) ?? selectedPersonalAgent("");
  const choose = async (id: string) => {
    if (
      switching ||
      working ||
      id === current?.id ||
      !agents.some((agent) => agent.id === id && agent.enabled)
    )
      return;
    setSwitching(true);
    try {
      // Finished executions no longer keep subsequent prompts bound to the previous agent.
      if (execution) await finishLocalExecution();
      if (useMistyStore.getState().accountId !== accountId) return;
      usePersonalAgentsStore.getState().select("", id);
      useMistyStore.setState({
        selectedAgentId: id,
        activeConversationId: "",
        executionMode: betaExecutionMode("user"),
        context: [],
        handoff: undefined,
        browserRequest: undefined,
        targets: [],
        error: null,
      });
    } catch (reason) {
      if (useMistyStore.getState().accountId === accountId)
        useMistyStore.setState({
          error: reason instanceof Error ? reason.message : String(reason),
        });
    } finally {
      setSwitching(false);
    }
  };
  return (
    <DropdownMenu>
      <MenuTrigger
        label={`Agent: ${current?.name ?? "Misty"}`}
        value={current?.name ?? "Misty"}
        title="Switch agent"
        icon={current ? <AgentAvatar agent={current} /> : undefined}
        className="min-w-0 gap-2 px-0 text-sm font-semibold [&>span]:max-w-36"
        disabled={
          working || switching || execution?.state === "running" || execution?.state === "paused"
        }
      />
      <DropdownMenuContent align="start" width="md" data-misty-layer-portal>
        {agents
          .filter((agent) => agent.enabled)
          .map((agent) => (
            <DropdownMenuItem key={agent.id} onSelect={() => void choose(agent.id)}>
              <AgentAvatar agent={agent} />
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              {agent.id === current?.id && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        {loading && !agents.length && (
          <p role="status" className="px-2 py-1.5 text-xs text-cream-muted">
            Loading agents…
          </p>
        )}
        {error && (
          <p role="alert" className="px-2 py-1.5 text-xs text-cream-muted">
            {error}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
