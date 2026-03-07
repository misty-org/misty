import type { Section, Category } from "./data";

export default function Sidebar({
  sections,
  categories,
  activeId,
  onSelect,
  open,
  onClose,
}: {
  sections: Section[];
  categories: Category[];
  activeId: string;
  onSelect: (id: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const inner = (
    <nav className="flex flex-col gap-6 py-6 px-4">
      {categories.map((cat) => (
        <div key={cat.key}>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-text-muted px-3 mb-2 block">
            {cat.label}
          </span>
          <div className="flex flex-col gap-0.5">
            {cat.ids.map((id) => {
              const sec = sections.find((s) => s.id === id)!;
              const active = activeId === id;
              return (
                <button
                  key={id}
                  onClick={() => { onSelect(id); onClose(); }}
                  className={`flex items-center gap-2 text-left px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-text-muted hover:text-text hover:bg-elevated"
                  }`}
                >
                  {sec.label}
                  {"badge" in sec && sec.badge && (
                    <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                      {sec.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <aside className="docs-sidebar hidden lg:block">{inner}</aside>
      {open && (
        <>
          <div className="docs-sidebar-overlay" onClick={onClose} />
          <aside className="docs-sidebar-mobile">{inner}</aside>
        </>
      )}
    </>
  );
}
