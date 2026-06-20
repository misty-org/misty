import type { Section, Category } from "./types";

export default function Sidebar({
  sections,
  categories,
  activeId,
  expandedCategories,
  onSelect,
  onToggleCategory,
  open,
  onClose,
}: {
  sections: Section[];
  categories: Category[];
  activeId: string;
  expandedCategories: Record<string, boolean>;
  onSelect: (id: string) => void;
  onToggleCategory: (key: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const inner = (
    <nav className="flex flex-col gap-1.5 p-2">
      {categories.map((cat) => (
        <div key={cat.key}>
          <button
            type="button"
            onClick={() => onToggleCategory(cat.key)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left"
          >
            <span className="text-[15.5px] font-medium text-white">
              {cat.label}
            </span>
            <svg
              className={`h-4 w-4 text-text-muted transition-transform ${
                expandedCategories[cat.key] ? "rotate-0" : "-rotate-90"
              }`}
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 7.5 10 12.5 15 7.5" />
            </svg>
          </button>
          {expandedCategories[cat.key] && (
            <div className="mt-0.5 flex flex-col">
              {cat.ids.map((id) => {
                const sec = sections.find((s) => s.id === id);
                if (!sec) return null;
                const active = activeId === id;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      onSelect(id);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[15.5px] transition-colors cursor-pointer ${
                      active
                        ? "bg-primary/10 font-medium text-white"
                        : "font-normal text-text-muted hover:bg-elevated hover:text-white"
                    }`}
                  >
                    {sec.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <aside className="hidden h-full overflow-y-auto border-r border-border-subtle lg:block">
        {inner}
      </aside>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <aside className="fixed top-0 left-0 bottom-0 z-50 w-[280px] bg-surface border-r border-border overflow-y-auto">
            {inner}
          </aside>
        </>
      )}
    </>
  );
}
