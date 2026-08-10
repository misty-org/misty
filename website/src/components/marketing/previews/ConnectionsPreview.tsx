import { ProductFrame } from "./ProductFrame";

const connections = [
  ["Google Calendar", "Pilot"],
  ["Slack", "Coming"],
  ["Notion", "Coming"],
  ["Discord", "Coming"],
];

export function ConnectionsPreview() {
  return (
    <ProductFrame title="Connections" meta="Beta preview">
      <div className="min-h-80 p-4 sm:p-6">
        <div className="mb-5 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Search connections
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {connections.map(([name, status]) => (
            <div
              key={name}
              className="flex items-center justify-between gap-4 px-4 py-4"
            >
              <span className="text-sm font-medium text-foreground">
                {name}
              </span>
              <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                {status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </ProductFrame>
  );
}
