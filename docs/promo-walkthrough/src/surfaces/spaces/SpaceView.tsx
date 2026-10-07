import { cn } from "@/shared/ui";
import { menuItemClass, menuListClass, popupSurfaceClass } from "@/shared/ui/overlays/popupStyles";
import { ChevronDown, User, X } from "lucide-react";
import { people, type PersonId } from "../../data/project";
import type { SpaceState } from "../../film/state";
import { ChatView } from "./ChatView";
import { BriefNote, SharedNote } from "./NoteView";
import { ChatPage, JournalPage, LibraryPage, PlannerPage } from "./SpaceCollections";
import { SpaceSidebar } from "./SpaceSidebar";

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-medium text-cream-muted">{label}</span>
      {children}
    </div>
  );
}

const field = "flex h-8 w-full items-center justify-between rounded-lg border border-charcoal-border px-2.5 text-xs font-medium text-cream";

function MemberAvatar({ id }: { id: PersonId }) {
  return (
    <span className="grid size-5 place-items-center rounded-full bg-[#3a3a3a] text-[8px] font-semibold text-cream">
      {people[id].initials}
    </span>
  );
}

/** Task drawer for "Export hero images", following TaskDrawerProperties. */
function TaskDrawer({ state }: { state: SpaceState }) {
  const assigned = state.assign === "assigned";
  return (
    <aside className="absolute inset-y-0 right-0 z-10 w-[340px] border-l border-charcoal-border bg-[#141414] p-5 shadow-2xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-cream-muted">WL-2</p>
          <p className="mt-1 text-lg font-semibold text-cream-bright">Export hero images</p>
        </div>
        <X data-t="drawer-close" className="size-4 text-cream-muted" aria-hidden />
      </div>
      <div className="mt-6 grid gap-4">
        <Property label="Status">
          <span className={field}>
            To do <ChevronDown className="size-3.5 text-cream-muted" />
          </span>
        </Property>
        <Property label="Priority">
          <span className={field}>
            High <ChevronDown className="size-3.5 text-cream-muted" />
          </span>
        </Property>
        <Property label="Assignee">
          <span className={cn(field, "relative", state.assign === "menu" && "bg-charcoal-hover")} data-t="assignee-field">
            <span className="flex items-center gap-2">
              {assigned ? <MemberAvatar id="sam" /> : <User className="size-3.5 text-cream-muted" />}
              {assigned ? people.sam.name : "Unassigned"}
            </span>
            <ChevronDown className="size-3.5 text-cream-muted" />
            {state.assign === "menu" && (
              <span className={cn(menuListClass, popupSurfaceClass, "absolute left-0 top-[calc(100%+6px)] z-20 w-56")}>
                <span className={cn(menuItemClass, "text-cream-muted")}>
                  <User className="size-3.5 opacity-60" /> Unassigned
                </span>
                <span className="px-2 py-1 text-[10px] font-semibold text-cream-muted">Members</span>
                {(Object.keys(people) as PersonId[]).map((id) => (
                  <span
                    key={id}
                    data-t={`assignee-${id}`}
                    data-highlighted={state.menuHighlight === id ? "" : undefined}
                    className={menuItemClass}
                  >
                    <MemberAvatar id={id} /> {people[id].name}
                  </span>
                ))}
              </span>
            )}
          </span>
        </Property>
        <Property label="Due date">
          <span className={field}>Mon, Oct 6</span>
        </Property>
      </div>
    </aside>
  );
}

function Main({ state }: { state: SpaceState }) {
  if (state.open === "brief") return <BriefNote />;
  if (state.open === "homepage-copy")
    return <SharedNote addition={state.noteAddition} caret={state.noteAddition !== undefined} />;
  if (state.open === "everyone") return <ChatView count={state.messageCount} />;
  switch (state.section) {
    case "planner":
      return <PlannerPage state={state} />;
    case "journal":
      return <JournalPage space={state.space} />;
    case "library":
      return <LibraryPage />;
    case "chat":
      return <ChatPage />;
  }
}

export function SpaceView({ state }: { state: SpaceState }) {
  return (
    <div className="flex h-full min-h-0">
      <SpaceSidebar state={state} />
      <div className="relative min-w-0 flex-1">
        <Main state={state} />
        {state.assign && state.assign !== "done" && <TaskDrawer state={state} />}
      </div>
    </div>
  );
}
