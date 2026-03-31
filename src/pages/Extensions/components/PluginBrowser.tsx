import { RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  PluginBrowserEntry,
  PluginBrowserTab,
} from "./types";
import { ExtensionCatalogIcon } from "../../../plugins/ExtensionCatalogIcon";

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

function statusPillClass(plugin: PluginBrowserEntry) {
  if (!plugin.installed) {
    return "border-white/10 bg-white/[0.03] text-zinc-300";
  }
  return plugin.enabled
    ? "border-white/12 bg-white/[0.05] text-white"
    : "border-white/10 bg-white/[0.03] text-zinc-400";
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
  return plugin.enabled ? "Disable" : "Enable";
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
    <section className="rounded-xl border border-white/8 bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4">
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      <div className="mt-3">{children}</div>
    </section>
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
    <button
      className={`w-full rounded-xl border p-3.5 text-left transition ${
        selected
          ? "border-white/18 bg-white/[0.04]"
          : "border-white/8 bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] hover:border-white/14 hover:bg-white/[0.02]"
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
            <p className="truncate text-[17px] font-medium text-white">
              {plugin.name}
            </p>
            <span
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium ${statusPillClass(plugin)}`}
            >
              {pluginStatus(plugin)}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-zinc-400">
            {plugin.overview}
          </p>
          <div className="mt-2.5 flex items-center gap-2 text-xs text-zinc-500">
            <span>{plugin.author || "Misty"}</span>
            {plugin.verified ? <span>verified</span> : null}
          </div>
        </div>
      </div>
    </button>
  );
}

const pluginSkeletonBlockClass =
  "relative overflow-hidden rounded-xl bg-white/[0.055] after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.35s_ease-in-out_infinite] after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.075),transparent)] after:content-['']";

function PluginListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="rounded-2xl border border-white/8 bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4">
          <div className="flex items-start gap-4">
            <span className={`${pluginSkeletonBlockClass} h-16 w-16 shrink-0`} />
            <span className="grid min-w-0 flex-1 gap-3">
              <span className="flex items-center justify-between gap-3">
                <span className={`${pluginSkeletonBlockClass} h-5 w-36`} />
                <span className={`${pluginSkeletonBlockClass} h-6 w-16 rounded-full`} />
              </span>
              <span className={`${pluginSkeletonBlockClass} h-4 w-full`} />
              <span className={`${pluginSkeletonBlockClass} h-4 w-4/5`} />
              <span className={`${pluginSkeletonBlockClass} h-3.5 w-28`} />
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
              <span className={`${pluginSkeletonBlockClass} h-9 w-64`} />
              <span className={`${pluginSkeletonBlockClass} h-7 w-24 rounded-full`} />
            </span>
            <span className={`${pluginSkeletonBlockClass} h-4 w-56`} />
          </div>
          <span className="flex items-center gap-2">
            <span className={`${pluginSkeletonBlockClass} h-10 w-24`} />
            <span className={`${pluginSkeletonBlockClass} h-10 w-28`} />
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <section className="rounded-2xl border border-white/8 bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4">
          <span className={`${pluginSkeletonBlockClass} block h-5 w-24`} />
          <div className="mt-4 grid gap-3">
            <span className={`${pluginSkeletonBlockClass} h-4 w-full`} />
            <span className={`${pluginSkeletonBlockClass} h-4 w-11/12`} />
            <span className={`${pluginSkeletonBlockClass} h-4 w-3/5`} />
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
  const hasPrimaryAction = Boolean(onPrimaryAction);

  return (
    <button
      className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={
        busy ||
        (!hasPrimaryAction &&
          ((!plugin.installed && !onInstall) ||
            (plugin.installed && !onToggle)))
      }
      onClick={() => {
        if (onPrimaryAction) {
          onPrimaryAction(plugin);
          return;
        }
        if (!plugin.installed) {
          onInstall?.(plugin);
          return;
        }
        onToggle?.(plugin, !plugin.enabled);
      }}
      type="button"
    >
      {hasPrimaryAction ? (primaryActionLabel ?? "Open Misty") : actionLabel(plugin)}
    </button>
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
      <div className="flex items-end justify-between gap-4 border-b border-white/[0.07] pb-3">
        <div>
          <h1 className="text-[30px] font-semibold tracking-normal text-white">{title}</h1>
        </div>
        {onRefresh ? (
          <button
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-white transition hover:bg-white/[0.06] disabled:cursor-progress disabled:opacity-55"
            disabled={loading}
            onClick={onRefresh}
            title="Reload extensions"
            type="button"
          >
            <RefreshCcw className={loading ? "animate-spin" : undefined} size={16} />
            Refresh
          </button>
        ) : null}
      </div>

      <div className="grid min-h-0 min-w-[1040px] flex-1 grid-cols-[360px_minmax(0,1fr)] gap-6 pt-6">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-white/8 bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))]">
          <div className="shrink-0 border-b border-white/[0.07] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-3">
            <div className="flex h-11 min-w-0 items-center rounded-xl border border-white/10 bg-transparent px-3.5 focus-within:border-white/25">
              <input
                aria-label="Search extensions"
                className="w-full bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500 disabled:cursor-progress"
                disabled={showSkeleton}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search extensions..."
                value={query}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl border border-white/8 bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-1">
              {(
                [
                  ["marketplace", "Marketplace"],
                  ["installed", "Installed"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    browserTab === value
                      ? "bg-white text-black"
                      : "text-zinc-400 hover:bg-white/[0.04]"
                  }`}
                  onClick={() => setBrowserTab(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.16em] text-zinc-500">
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

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-white/8 bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))]">
          {showSkeleton ? (
            <PluginDetailSkeleton />
          ) : selectedPlugin ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-white/[0.07] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="truncate text-[24px] font-semibold tracking-normal text-white">
                        {selectedPlugin.name}
                      </h2>
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusPillClass(selectedPlugin)}`}
                      >
                        {pluginStatus(selectedPlugin)}
                      </span>
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
                    {selectedPlugin.installed && onUninstall ? (
                      <button
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white transition hover:bg-white/[0.06]"
                        onClick={() => onUninstall(selectedPlugin)}
                        type="button"
                      >
                        Uninstall
                      </button>
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
                  <p className="max-w-4xl text-base leading-8 text-zinc-300">
                    {selectedPlugin.overview || "No overview yet."}
                  </p>
                </DetailSection>
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
