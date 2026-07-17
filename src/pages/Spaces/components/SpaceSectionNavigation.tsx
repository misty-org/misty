import { BookOpenText, MessagesSquare, PencilSparkles, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

const sections = [
  { id: "chat", label: "Chat", icon: MessagesSquare },
  { id: "library", label: "Library", icon: BookOpenText },
  { id: "studio", label: "Studio", icon: PencilSparkles },
  { id: "members", label: "Members", icon: Users },
] as const;

export function SpaceSectionNavigation({ spaceId, section }: { spaceId: string; section: string }) {
  const navigate = useNavigate();
  return <nav className="flex shrink-0 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-1" aria-label="Space sections">{sections.map(({ id, label, icon: Icon }) => <button key={id} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border-0 px-3 text-xs font-medium transition-colors max-[900px]:px-2.5 ${section === id ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)] shadow-sm" : "bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]"}`} type="button" onClick={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/${id === "studio" ? "studio/agents" : id}`)} aria-label={label} title={label} aria-current={section === id ? "page" : undefined}><Icon size={15}/><span className="max-[900px]:sr-only">{label}</span></button>)}</nav>;
}
