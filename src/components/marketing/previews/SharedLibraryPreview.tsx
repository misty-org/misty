import { cn } from "@/lib/utils";
import { ProductFrame } from "./ProductFrame";

const items = [
  ["Launch brief.pdf", "Alex", "Everyone"],
  ["Research notes.md", "Jordan", "Everyone"],
  ["Brand assets", "Alex", "Design"],
];

const filters = ["All", "Files", "Links", "Notes"];

export function SharedLibraryPreview() {
  return (
    <ProductFrame title="Library" meta="Shared with the Space">
      <div className="min-h-80 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          {filters.map((filter, index) => (
            <span
              key={filter}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                index === 0
                  ? "border-foreground bg-foreground font-medium text-background"
                  : "border-border text-muted-foreground",
              )}
            >
              {filter}
            </span>
          ))}
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {items.map(([name, addedBy, audience]) => (
            <div
              key={name}
              className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3 sm:grid-cols-[1fr_7rem_5rem]"
            >
              <span className="truncate text-xs font-medium text-foreground">
                {name}
              </span>
              <span className="hidden truncate text-xs text-muted-foreground sm:block">
                Added by {addedBy}
              </span>
              <span className="text-right text-xs text-muted-foreground">
                {audience}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Everything else on your device stays private.
        </p>
      </div>
    </ProductFrame>
  );
}
