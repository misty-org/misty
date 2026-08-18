import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { PersonalAgent } from "../model/interfaces/personal";
import { usePersonalAgentsStore } from "../store/usePersonalAgentsStore";

export interface PersonalAgentsSidebarProps {
  selectedAgentId: string;
  onSelect: (agent: PersonalAgent) => void;
  onEdit: (agent: PersonalAgent) => void;
  onCreate: () => void;
  onDelete: (agentId: string) => void;
}

function shortModel(id: string | undefined): string {
  if (!id) return "";
  const lower = id.toLowerCase();
  const family = lower.includes("opus")
    ? "Opus"
    : lower.includes("sonnet")
      ? "Sonnet"
      : lower.includes("haiku")
        ? "Haiku"
        : null;
  if (family) {
    const match = lower.match(/(?:opus|sonnet|haiku)-?(\d+(?:[-.]\d+)?)/);
    return match ? `${family} ${match[1].replace(/-/g, ".")}` : family;
  }
  if (lower.startsWith("gpt-")) {
    const match = lower.match(/^gpt-(\d+(?:\.\d+)?)/);
    return match ? `GPT-${match[1]}` : id.toUpperCase();
  }
  return id.split(/[-_/]/).slice(-2).join(" ").trim();
}

function agentInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toLowerCase() : "?";
}

function agentSubtitle(agent: PersonalAgent): string {
  const parts: string[] = [];
  const model = shortModel(agent.model_id);
  if (model) parts.push(model);
  const tools = agent.tool_permissions?.integrations?.length ?? 0;
  if (tools > 0) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
  if (parts.length > 0) return parts.join(" · ");
  return agent.role?.trim() || "Agent";
}

export function PersonalAgentsSidebar(props: PersonalAgentsSidebarProps) {
  const { agents, loading, load } = usePersonalAgentsStore(
    useShallow((state) => ({
      agents: state.agents,
      loading: state.loading,
      load: state.load,
    })),
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Agents">
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-3">
        <h2 className="m-0 truncate text-sm font-semibold text-cream-muted">Agents</h2>
        <Button size="icon" variant="ghost" className="size-8" onClick={props.onCreate}>
          <Plus size={14} />
          <span className="sr-only">Create Agent</span>
        </Button>
      </div>
      <nav className="misty-transient-scrollbar grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto">
        {agents.map((agent) => {
          const selected = props.selectedAgentId === agent.id;
          return (
            <ContextMenu key={agent.id}>
              <ContextMenuTrigger asChild>
                <div className="min-w-0 px-1">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-current={selected ? "true" : undefined}
                    className={[
                      "flex h-auto min-w-0 w-full items-center gap-2.5 rounded-md px-2 py-1.5",
                      "text-left shadow-none hover:bg-charcoal-hover",
                      selected ? "bg-charcoal-card" : "",
                    ].join(" ")}
                    onClick={() => props.onSelect(agent)}
                  >
                    <span className="relative grid size-[26px] shrink-0 place-items-center rounded-md bg-charcoal-hover text-[11px] font-medium text-cream-bright">
                      {agentInitial(agent.name)}
                      {agent.enabled ? (
                        <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-charcoal-sidebar bg-emerald-500" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={[
                          "block truncate text-[13px] font-medium",
                          selected ? "text-cream-bright" : "text-cream",
                        ].join(" ")}
                      >
                        {agent.name}
                      </span>
                      <span className="block truncate text-[11px] text-cream-muted">
                        {agentSubtitle(agent)}
                      </span>
                    </span>
                  </Button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => props.onEdit(agent)}>
                  <Settings2 size={14} /> Preferences…
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="text-cream-bright focus:text-cream-bright"
                  onSelect={() => props.onDelete(agent.id)}
                >
                  <Trash2 size={14} /> Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {!loading && agents.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-cream-muted">Create an Agent for repeat work.</p>
        ) : null}
      </nav>
    </section>
  );
}
