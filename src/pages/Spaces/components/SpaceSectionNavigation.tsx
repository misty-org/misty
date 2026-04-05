import { BookOpenText, Bot, CheckSquare2, MessagesSquare, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSpacesStore } from "../../../stores/useSpacesStore";

const sections = [
  { id: "chat", label: "Chat", icon: MessagesSquare },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "tasks", label: "Tasks", icon: CheckSquare2 },
  { id: "library", label: "Library", icon: BookOpenText },
  { id: "members", label: "Members", icon: Users },
] as const;

export function SpaceSectionNavigation({ spaceId, section }: { spaceId: string; section: string }) {
  const navigate = useNavigate();
  const permissions = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId)?.permissions);
  const visibleSections = sections
    .filter(({ id }) => id !== "chat" || permissions?.["messages.read"] !== false)
    .filter(({ id }) => id !== "agents" || permissions?.["agents.run"] !== false)
    .filter(({ id }) => id !== "tasks" || permissions?.["tasks.view"] !== false)
    .filter(({ id }) => id !== "library" || permissions?.["library.view"] !== false);
  return <nav className="grid shrink-0 grid-flow-col auto-cols-fr rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-1" aria-label="Space sections">{visibleSections.map(({ id, label, icon: Icon }) => <button key={id} className={`grid min-h-9 place-items-center rounded-lg border-0 p-0 transition-colors ${section === id ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)] shadow-sm" : "bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]"}`} type="button" onClick={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/${id}`)} aria-label={label} title={label} aria-current={section === id ? "page" : undefined}><Icon size={16}/><span className="sr-only">{label}</span></button>)}</nav>;
}
