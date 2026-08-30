import { SystemErrorActivity } from "@/features/activity";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ChevronDown, ChevronLeft, ChevronRight, Funnel, RefreshCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { filterPlugins } from "./helpers";
import { MarketplaceCard } from "./MarketplaceCard";
import { MarketplaceDetailDialog } from "./MarketplaceDetailDialog";
import type { MarketplaceEntry, MarketplaceView } from "./types";

type MarketplaceBrowserProps = {
  marketplacePlugins: MarketplaceEntry[];
  installedPlugins?: MarketplaceEntry[];
  loading?: boolean;
  error?: string;
  notice?: string;
  query: string;
  selectedPluginId?: string;
  onQueryChange: (query: string) => void;
  onSelect: (pluginId: string) => void;
  onInstall?: (plugin: MarketplaceEntry) => void;
  onToggle?: (plugin: MarketplaceEntry, enabled: boolean) => void;
  onUninstall?: (plugin: MarketplaceEntry) => void;
  onRefresh?: () => void;
  primaryActionLabel?: string;
  onPrimaryAction?: (plugin: MarketplaceEntry) => void;
};

type MarketplaceCategory = "all" | "misty" | "extensions";

const categoryLabels: Record<MarketplaceCategory, string> = {
  all: "All",
  misty: "Apps",
  extensions: "Extensions",
};

const marketplacePageSize = 50;

const gridClass = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

function PluginGridSkeleton() {
  return (
    <div aria-hidden="true" className={gridClass}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Card className="gap-3" key={index} size="sm">
          <div className="flex items-center gap-3 px-6">
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <span className="grid min-w-0 flex-1 gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </span>
          </div>
          <div className="grid gap-1.5 px-6">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="flex justify-end px-6">
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function MarketplaceBrowser({
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
}: MarketplaceBrowserProps) {
  const [browserTab, setBrowserTab] = useState<MarketplaceView>("marketplace");
  const [category, setCategory] = useState<MarketplaceCategory>("all");
  const [page, setPage] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const activePlugins = browserTab === "installed" ? installedPlugins : marketplacePlugins;
  const showSkeleton = loading && activePlugins.length === 0;

  const filteredPlugins = useMemo(
    () =>
      filterPlugins(activePlugins, query, browserTab).filter((plugin) => {
        if (category === "all") return true;
        if (category === "misty") return plugin.kind === "builtin";
        return plugin.kind !== "builtin";
      }),
    [activePlugins, browserTab, category, query],
  );
  const lastPage = Math.max(0, Math.ceil(filteredPlugins.length / marketplacePageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const rangeStart = filteredPlugins.length ? currentPage * marketplacePageSize + 1 : 0;
  const rangeEnd = Math.min((currentPage + 1) * marketplacePageSize, filteredPlugins.length);
  const visiblePlugins = filteredPlugins.slice(
    currentPage * marketplacePageSize,
    (currentPage + 1) * marketplacePageSize,
  );
  const changePage = (nextPage: number) => {
    setPage(Math.max(0, Math.min(nextPage, lastPage)));
    resultsRef.current?.scrollTo?.({ top: 0 });
  };
  const resetPage = () => changePage(0);
  // Only an explicit card click or a `?plugin=` deep link opens the detail
  // dialog, so an empty selection has to stay empty here.
  const selectedPlugin = selectedPluginId
    ? ([...marketplacePlugins, ...installedPlugins].find(
        (plugin) => plugin.id === selectedPluginId,
      ) ?? undefined)
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden px-8 py-5 max-[720px]:px-4 max-[720px]:py-4">
      <div>
        <h1 className="text-lg font-semibold text-cream-bright">Marketplace</h1>
        <p className="mt-1 text-sm text-cream-muted">
          Discover built-in Misty apps and extensions for your workspace.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search apps"
          className="h-9 w-full max-w-xs"
          disabled={showSkeleton}
          onChange={(event) => {
            resetPage();
            onQueryChange(event.target.value);
          }}
          placeholder="Search apps..."
          value={query}
        />

        <Tabs
          value={browserTab}
          onValueChange={(value) => {
            resetPage();
            setBrowserTab(value as MarketplaceView);
          }}
        >
          <TabsList variant="line">
            <TabsTrigger value="marketplace">Discover</TabsTrigger>
            <TabsTrigger value="installed">Installed</TabsTrigger>
          </TabsList>
        </Tabs>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`Filter by app type: ${categoryLabels[category]}`}
              className="h-9 gap-2 px-3 text-cream-muted shadow-none hover:text-cream-bright"
              size="sm"
              type="button"
              variant="outline"
            >
              <Funnel aria-hidden="true" size={15} strokeWidth={1.9} />
              <span>{categoryLabels[category]}</span>
              <ChevronDown aria-hidden="true" className="text-cream-muted" size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuRadioGroup
              onValueChange={(value) => {
                resetPage();
                setCategory(value as MarketplaceCategory);
              }}
              value={category}
            >
              <DropdownMenuRadioItem indicator="check" value="all">
                All
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem indicator="check" value="misty">
                Apps
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem indicator="check" value="extensions">
                Extensions
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {onRefresh ? (
          <Button
            aria-label="Reload extensions"
            className="size-8 text-cream-muted/70 shadow-none hover:text-cream"
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

        <div aria-label="Marketplace pages" className="ml-auto flex shrink-0 items-center gap-1">
          <span aria-live="polite" className="mr-1 text-xs tabular-nums text-cream-muted">
            {showSkeleton
              ? "Loading"
              : filteredPlugins.length
                ? `${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${filteredPlugins.length.toLocaleString()}`
                : "0 of 0"}
          </span>
          <Button
            aria-label="Previous page"
            className="size-8 text-cream-muted shadow-none hover:text-cream-bright"
            disabled={showSkeleton || currentPage === 0}
            onClick={() => changePage(currentPage - 1)}
            size="icon"
            title="Previous page"
            type="button"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" size={17} strokeWidth={1.9} />
          </Button>
          <Button
            aria-label="Next page"
            className="size-8 text-cream-muted shadow-none hover:text-cream-bright"
            disabled={showSkeleton || currentPage === lastPage}
            onClick={() => changePage(currentPage + 1)}
            size="icon"
            title="Next page"
            type="button"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" size={17} strokeWidth={1.9} />
          </Button>
        </div>
      </div>

      {notice ? <p className="text-xs text-cream-muted">{notice}</p> : null}
      {error ? (
        <SystemErrorActivity
          error={error}
          scope="marketplace"
          title="Marketplace could not be refreshed"
          target={{ kind: "workspace-tool", tool: "marketplace" }}
        />
      ) : null}

      <div
        ref={resultsRef}
        className="misty-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {showSkeleton ? (
          <PluginGridSkeleton />
        ) : visiblePlugins.length ? (
          <div className={gridClass}>
            {visiblePlugins.map((plugin) => (
              <MarketplaceCard
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
          <div className="rounded-xl border border-dashed px-5 py-10 text-center text-sm text-cream-muted">
            No apps match the current filter.
          </div>
        )}
      </div>

      <MarketplaceDetailDialog
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
