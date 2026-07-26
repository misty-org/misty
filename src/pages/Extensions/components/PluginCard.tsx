import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/ui/card";
import { ExtensionCatalogIcon } from "../../../plugins/ExtensionCatalogIcon";
import type { PluginBrowserEntry } from "./types";
import { pluginStatus, statusBadgeVariant } from "./helpers";
import { PluginPrimaryAction, type PluginActionHandlers } from "./PluginPrimaryAction";

export function PluginCard({
  plugin,
  busy,
  onOpenDetails,
  ...actions
}: PluginActionHandlers & {
  plugin: PluginBrowserEntry;
  busy: boolean;
  onOpenDetails: () => void;
}) {
  return (
    <Card className="relative h-full gap-3 transition-colors hover:bg-muted/40" size="sm">
      <CardHeader className="grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <ExtensionCatalogIcon
          className="size-10"
          logoSrc={plugin.logoSrc}
          pluginId={plugin.id}
          pluginName={plugin.name}
          roundedClassName="rounded-lg"
          textClassName="text-xs font-semibold text-white"
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{plugin.name}</p>
            <Badge className="shrink-0 text-[10px]" variant={statusBadgeVariant(plugin)}>
              {pluginStatus(plugin)}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {plugin.author || "Misty"} · v{plugin.version}
          </p>
        </div>
      </CardHeader>

      {/* Grows so the action row stays pinned to the bottom of every card in a
          row, whatever length the overview clamps to. */}
      <CardContent className="flex-1">
        <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{plugin.overview}</p>
      </CardContent>

      <CardFooter className="justify-end">
        <PluginPrimaryAction
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
