import { cn } from "@/lib/utils";
import { ProductFrame } from "./ProductFrame";

const sources = [
  ["Launch plan conversations", "Permitted"],
  ["Space Library", "Permitted"],
  ["Your private files", "Excluded"],
];

export function AgentBuilderPreview() {
  return (
    <ProductFrame title="New Agent" meta="Model routing · Automatic">
      <div className="min-h-80 p-4 sm:p-6">
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
          <p className="text-[11px] text-muted-foreground">Name</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            Launch assistant
          </p>
        </div>
        <p className="mt-6 text-[11px] font-medium text-muted-foreground">
          Context this Agent can use
        </p>
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {sources.map(([source, access]) => (
            <div
              key={source}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="truncate text-xs font-medium text-foreground">
                {source}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[10px]",
                  access === "Permitted"
                    ? "border-foreground text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                {access}
              </span>
            </div>
          ))}
        </div>
      </div>
    </ProductFrame>
  );
}
