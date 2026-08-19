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
import { AgentAvatar } from "../AgentAvatar";

export interface PersonalAgentsSidebarProps {
  selectedAgentId: string;
  onSelect: (agent: PersonalAgent) => void;
  onEdit: (agent: PersonalAgent) => void;
  onCreate: () => void;
  onDelete: (agentId: string) => void;
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
                    <span className="relative shrink-0">
                      <AgentAvatar
                        agentId={agent.id}
                        avatar={agent.avatar}
                        legacyIcon={agent.icon}
                        name={agent.name}
                        className="size-[26px]"
                        iconClassName="size-3.5"
                      />
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
