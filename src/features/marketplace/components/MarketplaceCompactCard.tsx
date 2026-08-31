import { cn } from "@/shared/ui";
import { Button } from "@/shared/ui/button";
import { MarketplaceCatalogIcon } from "./MarketplaceCatalogIcon";
import {
  MarketplacePrimaryAction,
  type MarketplaceActionHandlers,
} from "./MarketplacePrimaryAction";
import type { MarketplaceEntry } from "./types";

export function MarketplaceCompactCard({
  plugin,
  busy,
  onOpenDetails,
  ...actions
}: MarketplaceActionHandlers & {
  plugin: MarketplaceEntry;
  busy: boolean;
  onOpenDetails: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative grid min-h-24 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3",
        "rounded-lg border border-charcoal-border bg-charcoal-card p-3 transition-colors",
        "hover:bg-charcoal-hover/45",
      )}
    >
      <MarketplaceCatalogIcon
        className="size-10"
        logoSrc={plugin.logoSrc}
        pluginId={plugin.id}
        pluginName={plugin.name}
        roundedClassName="rounded-lg"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-cream-bright" data-marketplace-entry-name>
          {plugin.name}
        </p>
        <p className="mt-1 line-clamp-2 text-xs leading-4 text-cream-muted">{plugin.overview}</p>
      </div>
      <MarketplacePrimaryAction
        busy={busy}
        className="relative z-20 self-end"
        plugin={plugin}
        size="sm"
        {...actions}
      />
      <Button
        className={cn(
          "absolute inset-0 z-10 h-full w-full rounded-lg bg-transparent text-transparent",
          "hover:bg-transparent focus-visible:border-charcoal-active",
        )}
        onClick={onOpenDetails}
        type="button"
        variant="ghost"
      >
        <span className="sr-only">View {plugin.name} details</span>
      </Button>
    </div>
  );
}
