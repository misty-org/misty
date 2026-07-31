import { RefreshCcw } from "lucide-react";
import { useMemo, useState } from "react";
import type { PluginBrowserEntry, PluginBrowserTab } from "./types";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { Input } from "@/ui/input";
import { Skeleton } from "@/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { filterPlugins } from "./helpers";
import { PluginCard } from "./PluginCard";
import { PluginDetailDialog } from "./PluginDetailDialog";

type PluginBrowserProps = {
  marketplacePlugins: PluginBrowserEntry[];
  installedPlugins?: PluginBrowserEntry[];
  loading?: boolean;
  error?: string;
  notice?: string;
  query: string;
  selectedPluginId?: string;
  onQueryChange: (query: string) => void;
  onSelect: (pluginId: string) => void;
  onInstall?: (plugin: PluginBrowserEntry) => void;
  onToggle?: (plugin: PluginBrowserEntry, enabled: boolean) => void;
  onUninstall?: (plugin: PluginBrowserEntry) => void;
  onRefresh?: () => void;
  primaryActionLabel?: string;
  onPrimaryAction?: (plugin: PluginBrowserEntry) => void;
};

const gridClass = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

function PluginGridSkeleton() {
  return (
    <div aria-hidden="true" className={gridClass}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Card className="gap-3" key={index} size="sm">
          <div className="flex items-center gap-3 px-(--card-spacing)">
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <span className="grid min-w-0 flex-1 gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </span>
          </div>
          <div className="grid gap-1.5 px-(--card-spacing)">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="flex justify-end px-(--card-spacing)">
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function PluginBrowser({
  marketplacePlugins,
  installedPlugins = [],
  loading = false,
  error = "",
  notice = "",
  query,
  selectedPluginId,
  onQueryChange,
  onSelect,
  onInstall,
  onToggle,
  onUninstall,
  onRefresh,
  primaryActionLabel,
  onPrimaryAction,
}: PluginBrowserProps) {
  const [browserTab, setBrowserTab] = useState<PluginBrowserTab>("marketplace");
  const activePlugins = browserTab === "installed" ? installedPlugins : marketplacePlugins;
  const showSkeleton = loading && activePlugins.length === 0;

  const visiblePlugins = useMemo(
    () => filterPlugins(activePlugins, query, browserTab),
    [activePlugins, query, browserTab],
  );
  // Only an explicit card click or a `?plugin=` deep link opens the detail
  // dialog, so an empty selection has to stay empty here.
  const selectedPlugin = selectedPluginId
    ? ([...marketplacePlugins, ...installedPlugins].find(
        (plugin) => plugin.id === selectedPluginId,
      ) ?? undefined)
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden px-8 py-5 max-[720px]:px-4 max-[720px]:py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search extensions"
          className="h-9 w-full max-w-xs"
          disabled={showSkeleton}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search extensions..."
          value={query}
        />

        <Tabs
          value={browserTab}
          onValueChange={(value) => setBrowserTab(value as PluginBrowserTab)}
        >
          <TabsList variant="line">
            <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
            <TabsTrigger value="installed">Installed</TabsTrigger>
          </TabsList>
        </Tabs>

        <span className="text-xs text-muted-foreground">
          {showSkeleton ? "loading" : visiblePlugins.length}
        </span>

        {onRefresh ? (
          <Button
            aria-label="Reload extensions"
            className="ml-auto size-8 text-muted-foreground/70 shadow-none hover:text-foreground"
            disabled={loading}
            onClick={onRefresh}
            size="icon"
            title="Reload extensions"
            type="button"
            variant="ghost"
          >
            <RefreshCcw className={loading ? "animate-spin" : undefined} size={15} />
          </Button>
        ) : null}
      </div>

      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="misty-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {showSkeleton ? (
          <PluginGridSkeleton />
        ) : visiblePlugins.length ? (
          <div className={gridClass}>
            {visiblePlugins.map((plugin) => (
              <PluginCard
                busy={loading}
                key={plugin.id}
                onInstall={onInstall}
                onOpenDetails={() => onSelect(plugin.id)}
                onPrimaryAction={onPrimaryAction}
                onToggle={onToggle}
                plugin={plugin}
                primaryActionLabel={primaryActionLabel}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed px-5 py-10 text-center text-sm text-muted-foreground">
            No extensions match the current filter.
          </div>
        )}
      </div>

      <PluginDetailDialog
        busy={loading}
        onClose={() => onSelect("")}
        onInstall={onInstall}
        onPrimaryAction={onPrimaryAction}
        onToggle={onToggle}
        onUninstall={onUninstall}
        plugin={selectedPlugin}
        primaryActionLabel={primaryActionLabel}
      />
    </div>
  );
}
