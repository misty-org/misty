import { cn } from "@/shared/ui";
import { Gauge, Images, Layers, ListTodo, MessagesSquare, Notebook, UsersRound, type LucideIcon } from "lucide-react";
import { spaces } from "../../data/project";
import type { SpaceState } from "../../film/state";

const sections: { id: SpaceState["section"] | "all"; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "All", icon: Layers },
  { id: "chat", label: "Chat", icon: MessagesSquare },
  { id: "planner", label: "Planner", icon: ListTodo },
  { id: "journal", label: "Journal", icon: Notebook },
  { id: "library", label: "Library", icon: Images },
];

const recents: Record<SpaceState["space"], { label: string; icon: LucideIcon }[]> = {
  personal: [
    { label: "Launch brief", icon: Notebook },
    { label: "Export hero images", icon: ListTodo },
    { label: "Brand guidelines.pdf", icon: Images },
  ],
  team: [
    { label: "Everyone", icon: MessagesSquare },
    { label: "Homepage copy", icon: Notebook },
    { label: "Export hero images", icon: ListTodo },
  ],
};

function Row({ label, icon: Icon, active, t }: { label: string; icon: LucideIcon; active?: boolean; t?: string }) {
  return (
    <div
      data-t={t}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm",
        active ? "bg-[#282828] text-cream-bright" : "text-cream-muted",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  );
}

/** The named Space sidebar: identity, sections, recents. */
export function SpaceSidebar({ state }: { state: SpaceState }) {
  const space = spaces[state.space];
  return (
    <aside className="flex h-full w-[224px] shrink-0 flex-col border-r border-charcoal-border bg-[#161616] px-2 pt-3">
      <div className="flex h-9 items-center gap-2 px-1.5">
        <span className="grid size-[26px] place-items-center rounded-[7px] bg-cream-bright text-[10px] font-semibold text-charcoal-bg">
          {space.initials}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-cream-bright">{space.name}</span>
        <UsersRound className="size-4 text-cream-muted" aria-hidden />
        <Gauge className="ml-2 size-4 text-cream-muted" aria-hidden />
      </div>
      <p className="mt-4 mb-1 px-2.5 text-xs font-medium text-cream-muted">Explore</p>
      <div className="grid gap-0.5">
        {sections.map((section) => (
          <Row
            key={section.id}
            t={`space-${state.space}-${section.id}`}
            label={section.label}
            icon={section.icon}
            active={section.id === state.section}
          />
        ))}
      </div>
      <p className="mt-6 mb-1 px-2.5 text-xs font-medium text-cream-muted">Recents</p>
      <div className="grid gap-0.5">
        {recents[state.space].map((item) => (
          <Row key={item.label} label={item.label} icon={item.icon} />
        ))}
      </div>
      {space.members > 1 && (
        <div className="mt-auto mb-3 flex items-center gap-2 px-2.5 text-xs text-cream-muted">
          <span className="flex -space-x-1.5">
            {["AR", "SP", "PS", "JT"].map((initials) => (
              <span
                key={initials}
                className="grid size-6 place-items-center rounded-full bg-[#3a3a3a] text-[9px] font-semibold text-cream ring-2 ring-[#161616]"
              >
                {initials}
              </span>
            ))}
          </span>
          {space.members} members
        </div>
      )}
    </aside>
  );
}
