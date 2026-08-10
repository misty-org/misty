import { cn } from "@/lib/utils";
import { ProductFrame } from "./ProductFrame";

const files = [
  ["Launch brief.pdf", "2.4 MB", "Local"],
  ["Research notes.md", "18 KB", "Connected"],
  ["Brand assets", "Folder", "Local"],
  ["Interview clips", "Folder", "Connected"],
];

const locations = ["Local", "Connected", "Recent"];

export function FilesPreview() {
  return (
    <ProductFrame title="Files" meta="Private to you">
      <div className="grid min-h-[22rem] sm:grid-cols-[10rem_1fr]">
        <div className="hidden border-r border-border bg-muted/25 p-3 sm:block">
          <p className="px-2 py-2 text-[11px] font-medium text-muted-foreground">
            Locations
          </p>
          {locations.map((location, index) => (
            <div
              key={location}
              className={cn(
                "mt-1 rounded-md px-3 py-2 text-xs",
                index === 0
                  ? "bg-background font-medium text-foreground shadow-xs"
                  : "text-muted-foreground",
              )}
            >
              {location}
            </div>
          ))}
        </div>
        <div className="min-w-0 p-4 sm:p-5">
          <div className="mb-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Search Files
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {files.map(([name, size, source]) => (
              <div
                key={name}
                className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3 sm:grid-cols-[1fr_5rem_5rem]"
              >
                <span className="truncate text-xs font-medium text-foreground">
                  {name}
                </span>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {size}
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {source}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ProductFrame>
  );
}
