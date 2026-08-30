import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/shared/ui/card";
import { MarketplaceCatalogIcon } from "./MarketplaceCatalogIcon";
import { pluginStatus, statusBadgeVariant } from "./helpers";
import {
  MarketplacePrimaryAction,
  type MarketplaceActionHandlers,
} from "./MarketplacePrimaryAction";
import type { MarketplaceEntry } from "./types";

export function MarketplaceCard({
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
    <Card className="relative h-full gap-3 transition-colors hover:bg-charcoal-card" size="sm">
      <CardHeader className="grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <MarketplaceCatalogIcon
          className="size-10"
          logoSrc={plugin.logoSrc}
          pluginId={plugin.id}
          pluginName={plugin.name}
          roundedClassName="rounded-lg"
          textClassName="text-xs font-semibold text-cream-bright"
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium text-cream">{plugin.name}</p>
            <Badge className="shrink-0 text-[10px]" variant={statusBadgeVariant(plugin)}>
              {pluginStatus(plugin)}
            </Badge>
          </div>
          <p className="truncate text-xs text-cream-muted">
            {plugin.author || "Misty"} · v{plugin.version}
          </p>
        </div>
      </CardHeader>

      {/* Grows so the action row stays pinned to the bottom of every card in a
          row, whatever length the overview clamps to. */}
      <CardContent className="flex-1">
        <p className="line-clamp-2 text-xs leading-5 text-cream-muted">{plugin.overview}</p>
      </CardContent>

      <CardFooter className="justify-end">
        <MarketplacePrimaryAction
          busy={busy}
          className="relative z-20"
          plugin={plugin}
          size="sm"
          {...actions}
        />
      </CardFooter>

      {/* Full-card click target for the detail dialog. It sits above the text but
          below the primary action so both stay reachable by mouse and keyboard. */}
      <Button
        className="absolute inset-0 z-10 h-full w-full rounded-xl opacity-0"
        onClick={onOpenDetails}
        type="button"
        variant="ghost"
      >
        <span className="sr-only">View {plugin.name} details</span>
      </Button>
    </Card>
  );
}
