import { cn, NavIsland, NavIslandItem } from "@/shared/ui";
import { Mic, MousePointer2, Plus, Search } from "lucide-react";
import type { AgentsState } from "../../film/state";
import { AgentConversation } from "./AgentConversation";
import { Cloud, clouds } from "./Cloud";

const { sky, lavender, mint, peach } = clouds;
const roster = [
  { id: "misty", name: "Misty", sub: "Weekly plan", src: sky },
  { id: "research", name: "Research partner", sub: "Image size research", src: lavender },
  { id: "writing", name: "Writing partner", sub: "Product descriptions", src: peach },
  { id: "project-planner", name: "Project planner", sub: "", src: mint },
];

function Composer({ state }: { state: AgentsState }) {
  const draft = state.sent ? "" : (state.draft ?? "");
  return (
    <div className="mx-auto mb-5 w-full max-w-[780px] px-6">
      <div className="rounded-xl border border-charcoal-border bg-charcoal-card px-3 py-2.5" data-t="agent-composer">
        {state.attachment && !state.sent && (
          <span className="mb-2 inline-flex items-center gap-2 rounded-md border border-charcoal-border px-2 py-1 text-xs text-cream">
            <span className="grid size-5 place-items-center rounded bg-charcoal-active text-[9px]">N</span>
            Launch brief · Note
          </span>
        )}
        <div className="flex items-center gap-3">
          <span data-t="agent-attach" className="grid size-7 place-items-center rounded-md text-cream-muted">
            <Plus className="size-4" aria-hidden />
          </span>
          <span className={cn("flex-1 text-sm", draft ? "text-cream-bright" : "text-cream-muted")}>
            {draft || "Message Project planner…"}
            {draft && <span className="ml-px inline-block h-4 w-px translate-y-[3px] bg-cream-bright" />}
          </span>
          <Mic className="size-4 text-cream-muted" aria-hidden />
          <span data-t="agent-send" className="grid size-8 place-items-center rounded-md bg-charcoal-active text-cream">
            ↑
          </span>
        </div>
      </div>
    </div>
  );
}

export function AgentsView({ state }: { state: AgentsState }) {
  const selected = state.agent === "project-planner";
  return (
    <div className="flex h-full min-h-0 bg-[#101010]">
      <aside className="w-[243px] shrink-0 border-r border-charcoal-border p-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 flex-1 items-center gap-2 rounded-md border border-charcoal-border px-2.5 text-sm text-cream-muted">
            <Search className="size-4" aria-hidden /> Search
          </span>
          <Plus className="mx-2 size-4 text-cream-muted" aria-hidden />
        </div>
        <div className="mt-2 grid gap-1">
          {roster.map((agent) => (
            <div
              key={agent.id}
              data-t={`agent-${agent.id}`}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-2",
                selected && agent.id === "project-planner" && "bg-[#1f1f1f]",
              )}
            >
              <Cloud src={agent.src} size={38} />
              <span className="min-w-0">
                <span className="block text-sm text-cream-bright">{agent.name}</span>
                {(agent.sub || (selected && agent.id === "project-planner" && state.sent)) && (
                  <span className="block truncate text-xs text-cream-muted">
                    {agent.sub || "Launch brief checklist"}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </aside>
      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col items-center gap-2.5 pt-3">
          <span className="flex items-center gap-2 rounded-md bg-[#1b1b1b] px-2 py-1 text-sm font-medium text-cream-bright">
            <Cloud src={selected ? mint : sky} size={26} />
            {selected ? "Project planner" : "Misty"}
          </span>
          <NavIsland className="rounded-lg border border-charcoal-border p-1">
            {["Conversations", "Activity", "Profile"].map((label, index) => (
              <NavIslandItem key={label} active={index === 0} className="h-8 px-3 text-sm">
                {label}
              </NavIslandItem>
            ))}
          </NavIsland>
          <MousePointer2 className="absolute right-5 top-4 size-4 text-cream-muted" aria-hidden />
        </div>
        <AgentConversation state={state} />
        <Composer state={state} />
      </section>
    </div>
  );
}
