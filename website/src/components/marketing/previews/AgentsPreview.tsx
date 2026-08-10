import { ProductFrame } from "./ProductFrame";

export function AgentsPreview() {
  return (
    <ProductFrame title="Agents" meta="Collaborative AI">
      <div className="flex min-h-80 flex-col justify-end gap-4 p-4 sm:p-6">
        <div className="ml-auto max-w-[82%] rounded-xl rounded-br-md bg-foreground px-4 py-3 text-sm leading-6 text-background">
          What still needs a decision before launch?
        </div>
        <div className="max-w-[90%] rounded-xl rounded-bl-md border border-border bg-muted/35 px-4 py-3 text-sm leading-6 text-foreground/80">
          The release date and onboarding owner are still open in the launch
          brief.
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
          <span className="rounded-full border border-border px-2.5 py-1">
            Private conversation
          </span>
          <span className="rounded-full border border-border px-2.5 py-1">
            Permitted context
          </span>
        </div>
      </div>
    </ProductFrame>
  );
}
