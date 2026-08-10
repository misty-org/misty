import { usePersonalAgentsStore } from "@/features/agents";
import { spacesApi } from "@/api/spaces/api";
import type { SpaceAgentMembership } from "@/api/spaces/dto/interfaces/types";
import { errorText } from "@/shared/lib/format";
import {
  Badge,
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { Bot, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function AgentMembershipList({
  spaceId,
  agents,
  canManage,
  onReload,
  onError,
}: {
  spaceId: string;
  agents: SpaceAgentMembership[];
  canManage: boolean;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const personalAgents = usePersonalAgentsStore((state) => state.agents);
  const loadPersonalAgents = usePersonalAgentsStore((state) => state.load);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (canManage) void loadPersonalAgents();
  }, [canManage, loadPersonalAgents]);

  const available = useMemo(() => {
    const installed = new Set(agents.map((agent) => agent.agent_id));
    return personalAgents.filter((agent) => agent.enabled && !installed.has(agent.id));
  }, [agents, personalAgents]);

  const run = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await operation();
      await onReload();
      onError("");
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="mt-6" aria-label="Space agents">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="m-0 text-sm font-semibold">Agents</h3>
          <p className="mb-0 mt-1 text-xs text-cream-muted">
            {agents.length} non-human teammate{agents.length === 1 ? "" : "s"} · no human seats
          </p>
        </div>
        {canManage && available.length ? (
          <div className="flex items-center gap-2">
            <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
              <SelectTrigger className="h-9 w-48" aria-label="Choose an Agent">
                <SelectValue placeholder="Choose Agent" />
              </SelectTrigger>
              <SelectContent>
                {available.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!selectedAgentId || busy === "add"}
              onClick={() =>
                void run("add", async () => {
                  await spacesApi.addSpaceAgent(spaceId, selectedAgentId);
                  setSelectedAgentId("");
                })
              }
            >
              {busy === "add" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add Agent
            </Button>
          </div>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {agents.map((agent, index) => (
          <div
            key={agent.agent_id}
            className={`flex min-h-[72px] items-center gap-3 px-4 py-3 ${index ? "border-t border-charcoal-border/60" : ""}`}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-charcoal-active text-cream-bright">
              <Bot className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="m-0 truncate text-sm font-medium">{agent.name}</p>
                <Badge variant={agent.enabled ? "secondary" : "outline"}>
                  {agent.enabled ? "Active" : "Disabled"}
                </Badge>
                {agent.update_available ? <Badge variant="outline">Update available</Badge> : null}
              </div>
              <p className="mb-0 mt-0.5 truncate text-xs text-cream-muted">
                {agent.capability_grants?.length ?? 0} approved capabilities · approved v
                {agent.approved_version}
              </p>
            </div>
            {canManage ? (
              <div className="flex shrink-0 items-center gap-1">
                {agent.update_available ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run(`approve:${agent.agent_id}`, () =>
                        spacesApi.approveSpaceAgentVersion(spaceId, agent.agent_id),
                      )
                    }
                  >
                    <RefreshCw className="size-3.5" /> Approve v{agent.latest_version}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run(`toggle:${agent.agent_id}`, () =>
                      spacesApi.updateSpaceAgent(spaceId, agent, {
                        enabled: !agent.enabled,
                        role_id: agent.role_id,
                        space_role: agent.space_role ?? "",
                        space_instructions: agent.space_instructions ?? "",
                        permissions: agent.permissions,
                        capability_grants: agent.capability_grants,
                      }),
                    )
                  }
                >
                  {agent.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-cream-bright hover:text-cream-bright"
                  disabled={Boolean(busy)}
                  aria-label={`Remove ${agent.name}`}
                  onClick={() =>
                    void run(`remove:${agent.agent_id}`, () =>
                      spacesApi.removeSpaceAgent(spaceId, agent.agent_id),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        {!agents.length ? (
          <div className="grid min-h-32 place-items-center p-6 text-center">
            <div>
              <Bot className="mx-auto size-6 text-cream-muted" />
              <p className="mb-0 mt-2 text-sm font-medium">No Agents in this Space</p>
              <p className="mb-0 mt-1 text-xs text-cream-muted">
                Add one of your Agents as a teammate to assign tasks or mention it in chat.
              </p>
            </div>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
