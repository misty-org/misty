import { CheckCircle2, ExternalLink, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  PluginBrowserEntry,
  PluginBrowserTab,
} from "./types";
import { ExtensionCatalogIcon } from "../../../plugins/ExtensionCatalogIcon";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs";

type PluginBrowserProps = {
  title?: string;
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

function pluginStatus(plugin: PluginBrowserEntry) {
  if (!plugin.installed) {
    return "available";
  }
  return plugin.enabled ? "installed" : "disabled";
}

function statusBadgeVariant(plugin: PluginBrowserEntry) {
  return plugin.installed && plugin.enabled ? "secondary" as const : "outline" as const;
}

function filterPlugins(
  plugins: PluginBrowserEntry[],
  query: string,
  tab: PluginBrowserTab,
) {
  const normalized = query.trim().toLowerCase();
  return plugins.filter((plugin) => {
    if (tab === "installed" && !plugin.installed) {
      return false;
    }
    if (!normalized) {
      return true;
    }
    return [
      plugin.name,
      plugin.author,
      plugin.overview,
      plugin.id,
      plugin.version,
      ...plugin.capabilities,
      ...plugin.permissions,
      ...plugin.whereItAppears,
      ...plugin.gettingStarted,
      ...plugin.changelog,
      ...plugin.includedTools.map((tool) => `${tool.name} ${tool.version}`),
    ]
      .join("\n")
      .toLowerCase()
      .includes(normalized);
  });
}

function actionLabel(plugin: PluginBrowserEntry) {
  if (!plugin.installed) {
    return "Install";
  }
  return plugin.enabled ? "Open" : "Enable";
}

function PluginLogo({
  plugin,
  sizeClass,
  textClass,
  roundedClass,
}: {
  plugin: PluginBrowserEntry;
  sizeClass: string;
  textClass: string;
  roundedClass: string;
}) {
  return (
    <ExtensionCatalogIcon
      pluginId={plugin.id}
      pluginName={plugin.name}
      logoSrc={plugin.logoSrc}
      className={sizeClass}
      roundedClassName={roundedClass}
      textClassName={textClass}
    />
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-xl p-4">
      <p className="text-sm font-medium text-[var(--misty-text)]">{title}</p>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function SidebarPluginCard({
  plugin,
  selected,
  onClick,
}: {
  plugin: PluginBrowserEntry;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      className={`h-auto w-full justify-start rounded-xl border p-3.5 text-left transition ${
        selected
          ? "border-[var(--misty-border-strong)] bg-[var(--misty-surface-2)]"
          : "border-[var(--misty-border)] bg-[var(--misty-surface)] hover:border-[var(--misty-border-strong)] hover:bg-[var(--misty-surface-hover)]"
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start gap-4">
        <PluginLogo
          plugin={plugin}
          roundedClass="rounded-lg"
          sizeClass="h-16 w-16"
          textClass="text-sm font-semibold text-white"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="truncate text-[17px] font-medium text-[var(--misty-text)]">
              {plugin.name}
            </p>
            <Badge className="shrink-0 text-[10px]" variant={statusBadgeVariant(plugin)}>
              {pluginStatus(plugin)}
            </Badge>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--misty-text-muted)]">
            {plugin.overview}
          </p>
          <div className="mt-2.5 flex items-center gap-2 text-xs text-[var(--misty-text-subtle)]">
            <span>{plugin.author || "Misty"}</span>
            {plugin.verified ? <span>verified</span> : null}
          </div>
        </div>
      </div>
    </Button>
  );
}

function PluginListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="rounded-2xl border border-white/8 bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4">
          <div className="flex items-start gap-4">
            <Skeleton className="h-16 w-16 shrink-0 rounded-xl" />
            <span className="grid min-w-0 flex-1 gap-3">
              <span className="flex items-center justify-between gap-3">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </span>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3.5 w-28" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PluginDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-hidden="true">
      <div className="shrink-0 border-b border-white/[0.07] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid min-w-[320px] gap-3">
            <span className="flex items-center gap-3">
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </span>
            <Skeleton className="h-4 w-56" />
          </div>
          <span className="flex items-center gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-28" />
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <section className="rounded-2xl border border-white/8 bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4">
          <Skeleton className="h-5 w-24" />
          <div className="mt-4 grid gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        </section>
      </div>
    </div>
  );
}

function PrimaryAction({
  plugin,
  busy,
  onInstall,
  onToggle,
  primaryActionLabel,
  onPrimaryAction,
}: {
  plugin: PluginBrowserEntry;
  busy: boolean;
  onInstall?: (plugin: PluginBrowserEntry) => void;
  onToggle?: (plugin: PluginBrowserEntry, enabled: boolean) => void;
  primaryActionLabel?: string;
  onPrimaryAction?: (plugin: PluginBrowserEntry) => void;
}) {
  return (
    <Button
      className="h-10 rounded-xl px-4"
      disabled={
        busy ||
        ((!plugin.installed && !onInstall) ||
          (plugin.installed && !plugin.enabled && !onToggle) ||
          (plugin.installed && plugin.enabled && !onPrimaryAction))
      }
      onClick={() => {
        if (!plugin.installed) {
          onInstall?.(plugin);
          return;
        }
        if (!plugin.enabled) { onToggle?.(plugin, true); return; }
        onPrimaryAction?.(plugin);
      }}
      type="button"
    >
      {plugin.installed && plugin.enabled && primaryActionLabel ? primaryActionLabel : actionLabel(plugin)}
    </Button>
  );
}

export function PluginBrowser({
  title = "Extensions",
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
  const selectedPlugin =
    visiblePlugins.find((plugin) => plugin.id === selectedPluginId) ??
    activePlugins.find((plugin) => plugin.id === selectedPluginId) ??
    visiblePlugins[0] ??
    activePlugins[0];

  useEffect(() => {
    if (selectedPlugin && selectedPlugin.id !== selectedPluginId) {
      onSelect(selectedPlugin.id);
    }
  }, [onSelect, selectedPlugin, selectedPluginId]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1440px] flex-col overflow-x-auto overflow-y-hidden px-4 py-4 sm:px-5 lg:px-6">
      <div className="flex items-end justify-between gap-4 border-b border-[var(--misty-border)] pb-3">
        <div>
          <h1 className="text-[30px] font-semibold tracking-normal text-[var(--misty-text)]">{title}</h1>
        </div>
        {onRefresh ? (
          <Button
            className="h-10 rounded-xl px-4"
            variant="outline"
            disabled={loading}
            onClick={onRefresh}
            title="Reload extensions"
            type="button"
          >
            <RefreshCcw className={loading ? "animate-spin" : undefined} size={16} />
            Refresh
          </Button>
        ) : null}
      </div>

      <div className="grid min-h-0 min-w-[1040px] flex-1 grid-cols-[360px_minmax(0,1fr)] gap-6 pt-6">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[var(--misty-border)] bg-[var(--misty-surface)]">
          <div className="shrink-0 border-b border-white/[0.07] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-3">
            <div className="flex h-11 min-w-0 items-center rounded-xl border border-white/10 bg-transparent px-3.5 focus-within:border-white/25">
              <Input
                aria-label="Search extensions"
                className="h-full w-full border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0"
                disabled={showSkeleton}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search extensions..."
                value={query}
              />
            </div>

            <Tabs className="mt-3" value={browserTab} onValueChange={(value) => setBrowserTab(value as PluginBrowserTab)}>
              <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl p-1">
              {(
                [
                  ["marketplace", "Marketplace"],
                  ["installed", "Installed"],
                ] as const
              ).map(([value, label]) => (
                <TabsTrigger
                  key={value}
                  className="rounded-lg py-2 text-sm"
                  value={value}
                >
                  {label}
                </TabsTrigger>
              ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-3 flex items-center justify-between text-xs capitalize text-zinc-500">
              <span>{browserTab === "installed" ? "Installed" : "Marketplace"}</span>
              <span>{showSkeleton ? "loading" : visiblePlugins.length}</span>
            </div>

            {showSkeleton ? (
              <PluginListSkeleton />
            ) : (
              <div className="flex flex-col gap-3">
                {visiblePlugins.map((plugin) => (
                  <SidebarPluginCard
                    key={plugin.id}
                    onClick={() => onSelect(plugin.id)}
                    plugin={plugin}
                    selected={plugin.id === selectedPlugin?.id}
                  />
                ))}
                {visiblePlugins.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center text-sm text-zinc-500">
                    No extensions match the current filter.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[var(--misty-border)] bg-[var(--misty-surface)]">
          {showSkeleton ? (
            <PluginDetailSkeleton />
          ) : selectedPlugin ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-white/[0.07] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="truncate text-[24px] font-semibold tracking-normal text-[var(--misty-text)]">
                        {selectedPlugin.name}
                      </h2>
                      <Badge variant={statusBadgeVariant(selectedPlugin)}>
                        {pluginStatus(selectedPlugin)}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-zinc-500">
                        {selectedPlugin.author || "Misty"}
                      </span>
                      <span className="text-sm text-zinc-600">•</span>
                      <span className="text-sm text-zinc-500">
                        v{selectedPlugin.version}
                      </span>
                      {selectedPlugin.verified ? (
                        <>
                          <span className="text-sm text-zinc-600">•</span>
                          <span className="text-sm text-zinc-500">verified</span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <PrimaryAction
                      busy={loading}
                      onInstall={onInstall}
                      onPrimaryAction={onPrimaryAction}
                      onToggle={onToggle}
                      plugin={selectedPlugin}
                      primaryActionLabel={primaryActionLabel}
                    />
                    {selectedPlugin.installed && selectedPlugin.enabled && onToggle ? (
                      <Button className="h-10 rounded-xl px-4" onClick={() => onToggle(selectedPlugin, false)} variant="outline">Disable</Button>
                    ) : null}
                    {selectedPlugin.installed && onUninstall ? (
                      <Button
                        className="h-10 rounded-xl px-4"
                        onClick={() => onUninstall(selectedPlugin)}
                        variant="destructive"
                      >
                        Uninstall
                      </Button>
                    ) : null}
                  </div>
                </div>

                {notice ? (
                  <p className="mt-3 text-sm text-zinc-300">{notice}</p>
                ) : null}
                {error ? (
                  <p className="mt-3 text-sm text-red-300">{error}</p>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                <DetailSection title="Overview">
                  <p className="max-w-4xl text-sm leading-7 text-[var(--misty-text-muted)]">
                    {selectedPlugin.overview || "No overview yet."}
                  </p>
                </DetailSection>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <DetailSection title="Capabilities"><ul className="grid gap-2 text-sm text-[var(--misty-text-muted)]">{selectedPlugin.capabilities.map((item) => <li className="flex gap-2" key={item}><CheckCircle2 className="mt-0.5 shrink-0 text-[var(--misty-success)]" size={15}/><span>{item}</span></li>)}</ul></DetailSection>
                  <DetailSection title="Permissions"><ul className="grid gap-2 text-sm text-[var(--misty-text-muted)]">{selectedPlugin.permissions.map((item) => <li key={item}>{item}</li>)}</ul></DetailSection>
                  <DetailSection title="Placement"><dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm"><dt className="text-[var(--misty-text-subtle)]">Appears in</dt><dd className="text-[var(--misty-text-muted)]">{selectedPlugin.whereItAppears.join(", ") || selectedPlugin.placement.views.join(", ")}</dd><dt className="text-[var(--misty-text-subtle)]">Opens as</dt><dd className="capitalize text-[var(--misty-text-muted)]">{selectedPlugin.placement.openMode}</dd><dt className="text-[var(--misty-text-subtle)]">Selection</dt><dd className="text-[var(--misty-text-muted)]">{selectedPlugin.placement.requiresSelection ? "Required" : "Not required"}</dd></dl></DetailSection>
                  <DetailSection title="Included tools">{selectedPlugin.includedTools.length ? <ul className="grid gap-2 text-sm text-[var(--misty-text-muted)]">{selectedPlugin.includedTools.map((tool) => <li className="flex justify-between gap-3" key={`${tool.name}-${tool.version}`}><span>{tool.name}</span><code>{tool.version}</code></li>)}</ul> : <p className="text-sm text-[var(--misty-text-subtle)]">No executable tools included.</p>}</DetailSection>
                  <DetailSection title="Getting started"><ol className="grid list-decimal gap-2 pl-5 text-sm text-[var(--misty-text-muted)]">{selectedPlugin.gettingStarted.map((item) => <li key={item}>{item}</li>)}</ol></DetailSection>
                  <DetailSection title="Changelog"><ul className="grid gap-2 text-sm text-[var(--misty-text-muted)]">{selectedPlugin.changelog.map((item) => <li key={item}>{item}</li>)}</ul></DetailSection>
                </div>
                {selectedPlugin.links.length ? <div className="mt-3 flex flex-wrap gap-2">{selectedPlugin.links.map((link) => <a className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--misty-border)] px-3 py-2 text-sm text-[var(--misty-link)]" href={link.url} key={link.url} rel="noreferrer" target="_blank">{link.label}<ExternalLink size={13}/></a>)}</div> : null}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              No extensions match the current filter.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
