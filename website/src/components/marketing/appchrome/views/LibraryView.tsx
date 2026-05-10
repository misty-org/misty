import { cn } from "@/lib/utils";

const filters = ["All", "Files", "Links", "Notes"];

const items = [
  { name: "Launch brief.pdf", by: "Alex", when: "2h ago" },
  { name: "Research notes.md", by: "Jordan", when: "3h ago" },
  { name: "Competitive teardown", by: "Mika", when: "Yesterday" },
  { name: "Brand assets", by: "Alex", when: "Jul 21" },
  { name: "Interview — Sam K.", by: "Jordan", when: "Jul 19" },
];

/** The Space Library: what the group has deliberately pooled. */
export function LibraryView() {
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--app-border)] px-3">
        {filters.map((filter, index) => (
          <span
            key={filter}
            className={cn(
              "rounded-full border px-2.5 py-[3px] text-[11px]",
              index === 0
                ? "border-[var(--app-ink-bright)] bg-[var(--app-ink-bright)] font-medium text-[var(--app-bg)]"
                : "border-[var(--app-border)] text-[var(--app-ink-muted)]",
            )}
          >
            {filter}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-[var(--app-ink-muted)]">
          34 items
        </span>
      </div>

      <div className="min-h-0 flex-1 p-3">
        <div className="overflow-hidden rounded-lg border border-[var(--app-border)]">
          {items.map((item, index) => (
            <div
              key={item.name}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_88px_76px] items-center gap-3 px-3 py-[10px]",
                index > 0 && "border-t border-[var(--app-border)]",
              )}
            >
              <span className="truncate text-[12px] text-[var(--app-ink-bright)]">
                {item.name}
              </span>
              <span className="truncate text-[11px] text-[var(--app-ink-muted)]">
                Added by {item.by}
              </span>
              <span className="text-right text-[11px] text-[var(--app-ink-muted)]">
                {item.when}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
