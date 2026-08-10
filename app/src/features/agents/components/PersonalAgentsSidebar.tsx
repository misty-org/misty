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
  onCreate: () => void;
  onDelete: (agentId: string) => void;
}

/**
 * The Agent list. Selecting one opens it in the tab's right panel, so this
 * sidebar only tracks which Agent is selected — it owns no editor state.
 */
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
      <nav className="misty-transient-scrollbar grid min-h-0 flex-1 content-start gap-1 overflow-y-auto">
        {agents.map((agent) => (
          <section key={agent.id} className="grid min-w-0 gap-1">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="group/agent flex min-h-7 min-w-0 items-center gap-1 px-2">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-current={props.selectedAgentId === agent.id ? "true" : undefined}
                    className={[
                      "h-auto min-w-0 flex-1 justify-start gap-1.5 rounded-md px-0 py-0",
                      "text-left text-xs font-semibold shadow-none",
                      "hover:bg-transparent hover:text-cream-bright",
                      props.selectedAgentId === agent.id ? "text-cream-bright" : "text-cream-muted",
                    ].join(" ")}
                    onClick={() => props.onSelect(agent)}
                  >
                    <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 shrink-0 opacity-0 shadow-none group-hover/agent:opacity-100 focus-visible:opacity-100"
                    onClick={() => props.onSelect(agent)}
                  >
                    <Settings2 size={13} />
                    <span className="sr-only">Agent preferences for {agent.name}</span>
                  </Button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => props.onSelect(agent)}>
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
          </section>
        ))}
        {!loading && agents.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-cream-muted">Create an Agent for repeat work.</p>
        ) : null}
      </nav>
    </section>
  );
}
