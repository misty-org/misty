import { useEffect, useState } from "react";
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
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(
    {
      "getting-started": true,
    },
  );

  useEffect(() => {
    const activeCategory = sections.find(
      (section) => section.id === activeId,
    )?.category;
    if (!activeCategory) return;

    setOpenCategories((current) =>
      current[activeCategory]
        ? current
        : { ...current, [activeCategory]: true },
    );
  }, [activeId, sections]);

  const toggleCategory = (key: string) => {
    setOpenCategories((current) => ({ ...current, [key]: !current[key] }));
  };

  const inner = (
    <nav className="flex flex-col gap-4 p-2">
      {categories.map((cat) => (
        <div key={cat.key} className="pb-1">
          <button
            type="button"
            onClick={() => toggleCategory(cat.key)}
            className="flex w-full items-center justify-between px-3 py-2 text-left"
          >
            <span className="text-[15.5px] font-medium text-white">
              {cat.label}
            </span>
            <svg
              className={`h-4 w-4 text-text-muted transition-transform ${
                openCategories[cat.key] ? "rotate-0" : "-rotate-90"
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
          {openCategories[cat.key] && (
            <div className="mt-1 flex flex-col gap-0.5">
              {cat.ids.map((id) => {
                const sec = sections.find((s) => s.id === id)!;
                const active = activeId === id;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      onSelect(id);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[15.5px] transition-colors cursor-pointer ${
                      active
                        ? "bg-primary/10 font-medium text-white"
                        : "font-normal text-text-muted hover:bg-elevated hover:text-white"
                    }`}
                  >
                    {sec.label}
                    {"badge" in sec && sec.badge && (
                      <span className="ml-auto rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                        {sec.badge}
                      </span>
                    )}
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
