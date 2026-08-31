import { SystemErrorActivity } from "@/features/activity";
import { cn } from "@/shared/ui";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PanelLeftClose, PanelLeftOpen, RefreshCcw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { filterPlugins } from "./helpers";
import { MarketplaceCatalog } from "./MarketplaceCatalog";
import { MarketplaceDetailDialog } from "./MarketplaceDetailDialog";
import { MarketplaceHome } from "./MarketplaceHome";
import { MarketplaceStoreNav, type MarketplaceSection } from "./MarketplaceStoreNav";
import type { MarketplaceEntry } from "./types";

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

const defaultStoreSidebarWidth = 240;
const minStoreSidebarWidth = 220;
const maxStoreSidebarWidth = 360;

function clampStoreSidebarWidth(width: number) {
  return Math.min(maxStoreSidebarWidth, Math.max(minStoreSidebarWidth, width));
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
  const [section, setSection] = useState<MarketplaceSection>("featured");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(defaultStoreSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const storeLayoutRef = useRef<HTMLDivElement>(null);
  const pendingResizeXRef = useRef(0);
  const resizeFrameRef = useRef<number | null>(null);
  const apps = useMemo(
    () => marketplacePlugins.filter((plugin) => plugin.kind !== "extension"),
    [marketplacePlugins],
  );
  const extensions = useMemo(
    () => marketplacePlugins.filter((plugin) => plugin.kind === "extension"),
    [marketplacePlugins],
  );
  const installedItems = useMemo(
    () => installedPlugins.filter((plugin) => plugin.kind !== "builtin" && plugin.installed),
    [installedPlugins],
  );
  const searching = query.trim().length > 0;
  const searchedApps = useMemo(() => filterPlugins(apps, query, "marketplace"), [apps, query]);
  const searchedExtensions = useMemo(
    () => filterPlugins(extensions, query, "marketplace"),
    [extensions, query],
  );
  const selectedPlugin = selectedPluginId
    ? ([...marketplacePlugins, ...installedPlugins].find(
        (plugin) => plugin.id === selectedPluginId,
      ) ?? undefined)
    : undefined;
  const actions = {
    onInstall,
    onToggle,
    onPrimaryAction,
    primaryActionLabel,
  };

  useEffect(() => {
    if (!resizingSidebar) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const applyResize = () => {
      resizeFrameRef.current = null;
      const rect = storeLayoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSidebarWidth(clampStoreSidebarWidth(pendingResizeXRef.current - rect.left));
    };
    const onPointerMove = (event: globalThis.PointerEvent) => {
      pendingResizeXRef.current = event.clientX;
      if (resizeFrameRef.current === null) {
        resizeFrameRef.current = window.requestAnimationFrame(applyResize);
      }
    };
    const stopResize = () => setResizingSidebar(false);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizingSidebar]);

  const changeSection = (next: MarketplaceSection) => {
    setSection(next);
    if (query) onQueryChange("");
  };

  const resizeSidebarFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const increments: Record<string, number> = { ArrowLeft: -16, ArrowRight: 16 };
    if (event.key === "Home") {
      event.preventDefault();
      setSidebarWidth(minStoreSidebarWidth);
    } else if (event.key === "End") {
      event.preventDefault();
      setSidebarWidth(maxStoreSidebarWidth);
    } else if (event.key in increments) {
      event.preventDefault();
      setSidebarWidth((width) => clampStoreSidebarWidth(width + increments[event.key]));
    }
  };

  const startSidebarResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    pendingResizeXRef.current = event.clientX;
    setResizingSidebar(true);
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-bg"
      data-store-layout="true"
      ref={storeLayoutRef}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden max-[860px]:flex-col">
        {sidebarOpen ? (
          <div
            className="relative h-full shrink-0 max-[860px]:h-auto max-[860px]:w-full"
            data-store-sidebar-shell="true"
            style={{ width: sidebarWidth }}
          >
            <MarketplaceStoreNav
              active={section}
              installedCount={installedItems.length}
              onChange={changeSection}
            />
            <div
              aria-label="Resize Store sidebar"
              aria-orientation="vertical"
              aria-valuemax={maxStoreSidebarWidth}
              aria-valuemin={minStoreSidebarWidth}
              aria-valuenow={sidebarWidth}
              className={cn(
                "group absolute right-0 top-0 z-20 h-full w-2 translate-x-1/2 cursor-col-resize outline-none",
                "max-[860px]:hidden",
                "after:absolute after:inset-y-2 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:content-['']",
                "hover:after:bg-charcoal-active focus-visible:after:bg-cream-muted",
                resizingSidebar && "after:bg-cream-muted",
              )}
              data-store-sidebar-resizer="true"
              onDoubleClick={() => setSidebarWidth(defaultStoreSidebarWidth)}
              onKeyDown={resizeSidebarFromKeyboard}
              onPointerDown={startSidebarResize}
              role="separator"
              tabIndex={0}
            />
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-charcoal-border px-6 py-5 max-[640px]:px-4 max-[640px]:py-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="min-w-[220px] flex-1">
                <h1 className="text-lg font-semibold text-cream-bright">Store</h1>
                <p className="mt-1 text-xs text-cream-muted">
                  Discover tools for the way you work.
                </p>
              </div>
              <div className="flex w-full max-w-xl items-center gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cream-muted"
                    size={16}
                  />
                  <Input
                    aria-label="Search Store"
                    className="h-10 w-full pl-9"
                    disabled={loading && marketplacePlugins.length === 0}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && query) onQueryChange("");
                    }}
                    placeholder="Search Store"
                    value={query}
                  />
                </div>
                {onRefresh ? (
                  <Button
                    aria-label="Reload Store"
                    className="size-9 text-cream-muted shadow-none hover:text-cream max-[860px]:size-11"
                    disabled={loading}
                    onClick={onRefresh}
                    size="icon"
                    title="Reload Store"
                    type="button"
                    variant="ghost"
                  >
                    <RefreshCcw className={loading ? "animate-spin" : undefined} size={15} />
                  </Button>
                ) : null}
              </div>
            </div>
            {notice ? <p className="mt-3 text-xs text-cream-muted">{notice}</p> : null}
            {error ? (
              <div className="mt-3">
                <SystemErrorActivity
                  error={error}
                  scope="marketplace"
                  title="Store could not be refreshed"
                  target={{ kind: "workspace-tool", tool: "marketplace" }}
                />
              </div>
            ) : null}
          </header>

          <main className="misty-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 max-[640px]:px-4 max-[640px]:py-4">
            {searching ? (
              <div className="grid gap-8">
                <MarketplaceCatalog
                  description="Built-in and installable apps that match your search."
                  empty="No apps match this search."
                  entries={searchedApps}
                  loading={loading}
                  onSelect={onSelect}
                  title="Apps"
                  {...actions}
                />
                <MarketplaceCatalog
                  description="Installable capabilities that match your search. Review details and permissions before installing."
                  empty="No extensions match this search."
                  entries={searchedExtensions}
                  loading={loading}
                  onSelect={onSelect}
                  title="Extensions"
                  {...actions}
                />
              </div>
            ) : section === "featured" ? (
              <MarketplaceHome
                apps={apps}
                busy={loading}
                onNavigate={changeSection}
                onSelect={onSelect}
                {...actions}
              />
            ) : section === "apps" ? (
              <MarketplaceCatalog
                description="Built-in and installable apps open as full workspace tabs."
                empty="No apps are available."
                entries={apps}
                loading={loading}
                onSelect={onSelect}
                title="Apps"
                {...actions}
              />
            ) : section === "extensions" ? (
              <MarketplaceCatalog
                description="Extensions enhance an existing app at runtime, such as annotations inside Browser."
                empty="No app extensions are available yet."
                entries={extensions}
                loading={loading}
                onSelect={onSelect}
                title="Extensions"
                {...actions}
              />
            ) : (
              <MarketplaceCatalog
                description="Manage the apps installed on this device. Built-in apps are always available."
                empty="You have not installed any apps yet."
                entries={installedItems}
                loading={loading}
                onSelect={onSelect}
                title="Installed apps"
                {...actions}
              />
            )}
          </main>
        </div>
      </div>

      <footer
        className="flex h-10 shrink-0 items-center border-t border-charcoal-border bg-charcoal-workspace px-2"
        data-store-bottom-bar="true"
      >
        <Button
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? "Hide Store sidebar" : "Show Store sidebar"}
          className="size-8 text-cream-muted shadow-none hover:text-cream-bright"
          onClick={() => setSidebarOpen((open) => !open)}
          size="icon"
          title={sidebarOpen ? "Hide Store sidebar" : "Show Store sidebar"}
          type="button"
          variant="ghost"
        >
          {sidebarOpen ? (
            <PanelLeftClose aria-hidden="true" size={16} />
          ) : (
            <PanelLeftOpen aria-hidden="true" size={16} />
          )}
        </Button>
      </footer>

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
