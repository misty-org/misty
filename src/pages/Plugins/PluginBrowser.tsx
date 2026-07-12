import { useEffect, useMemo, useState } from "react";
import type {
  PluginBrowserEntry,
  PluginBrowserTab,
  PluginDetailTab,
} from "./types";

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
  primaryActionLabel?: string;
  onPrimaryAction?: (plugin: PluginBrowserEntry) => void;
  onOpenLink?: (url: string) => void;
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

function pluginInitials(plugin: PluginBrowserEntry) {
  return plugin.name
    .split(/[\s_-]+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
  const [imgFailed, setImgFailed] = useState(false);
  const [cacheBust, setCacheBust] = useState(() => Date.now().toString());

  useEffect(() => {
    setImgFailed(false);
    setCacheBust(Date.now().toString());
  }, [plugin.logoSrc]);

  const src = plugin.logoSrc && !imgFailed
    ? `${plugin.logoSrc}${plugin.logoSrc.includes("?") ? "&" : "?"}t=${cacheBust}`
    : "";

  return (
    <div
      className={`flex shrink-0 items-center justify-center border border-white/8 bg-[#121416] ${sizeClass} ${roundedClass} ${textClass}`}
    >
      {src ? (
        <img
          alt={`${plugin.name} logo`}
          className="h-[72%] w-[72%] object-contain"
          onError={() => setImgFailed(true)}
          src={src}
        />
      ) : (
        pluginInitials(plugin)
      )}
    </div>
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
    <section className="rounded-2xl border border-white/8 bg-[#0b0d0f] p-4">
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function BulletList({
  items,
  numbered = false,
}: {
  items: string[];
  numbered?: boolean;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">No details yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          className="flex items-start gap-3 text-sm leading-6 text-zinc-300"
        >
          {numbered ? (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-black">
              {index + 1}
            </span>
          ) : (
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
          )}
          <span>{item}</span>
        </div>
      ))}
    </div>
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
      className={`w-full rounded-2xl border p-4 text-left transition ${
        selected
          ? "border-white/18 bg-white/[0.04]"
          : "border-white/8 bg-[#0b0d0f] hover:border-white/14 hover:bg-white/[0.02]"
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start gap-4">
        <PluginLogo
          plugin={plugin}
          roundedClass="rounded-xl"
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
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-400">
            {plugin.overview}
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
            <span>{plugin.author || "Misty"}</span>
            {plugin.verified ? <span>verified</span> : null}
          </div>
        </div>
      </div>
    </button>
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
      {hasPrimaryAction ? (primaryActionLabel ?? "Open Misty Hub") : actionLabel(plugin)}
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
  primaryActionLabel,
  onPrimaryAction,
  onOpenLink,
}: PluginBrowserProps) {
  const [browserTab, setBrowserTab] = useState<PluginBrowserTab>("marketplace");
  const [detailTab, setDetailTab] = useState<PluginDetailTab>("overview");
  const activePlugins = browserTab === "installed" ? installedPlugins : marketplacePlugins;

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
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1440px] flex-col overflow-x-auto overflow-y-hidden px-5 py-4 sm:px-6 lg:h-screen lg:px-8 xl:px-10">
      <div className="flex items-end justify-between gap-4 border-b border-white/[0.07] pb-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] text-white">{title}</h1>
        </div>
      </div>

      <div className="grid min-h-0 min-w-[1080px] flex-1 grid-cols-[360px_minmax(0,1fr)] gap-8 pt-8">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[#090b0d]/95">
          <div className="shrink-0 border-b border-white/[0.07] bg-[#090b0d]/95 p-4 backdrop-blur-sm">
            <div className="flex items-center">
              <label className="flex h-12 min-w-0 flex-1 items-center rounded-2xl border border-white/8 bg-[#0b0d0f] px-4">
                <input
                  className="w-full bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500"
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Search Extensions..."
                  value={query}
                />
              </label>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-white/8 bg-[#0b0d0f] p-1">
              {(
                [
                  ["marketplace", "Marketplace"],
                  ["installed", "Installed"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
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

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-4 flex items-center justify-between text-xs uppercase tracking-[0.16em] text-zinc-500">
              <span>{browserTab === "installed" ? "Installed" : "Marketplace"}</span>
              <span>{visiblePlugins.length}</span>
            </div>

            <div className="flex flex-col gap-4">
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
                  No Extensions match the current filter.
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[#090b0d]/95">
          {selectedPlugin ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-white/[0.07] bg-[#090b0d]/95 px-6 py-4 backdrop-blur-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="truncate text-[28px] font-semibold tracking-[-0.03em] text-white">
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

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
                  <div className="flex items-center gap-5">
                    {(
                      [
                        ["overview", "Overview"],
                        ["changelog", "Changelog"],
                        ["details", "Details"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        className={`border-b pb-2 text-base transition ${
                          detailTab === value
                            ? "border-white text-white"
                            : "border-transparent text-zinc-500 hover:text-white"
                        }`}
                        onClick={() => setDetailTab(value)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedPlugin.links[0] && onOpenLink ? (
                      <button
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white transition hover:bg-white/[0.06]"
                        onClick={() => onOpenLink(selectedPlugin.links[0].url)}
                        type="button"
                      >
                        open link
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

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
                {detailTab === "overview" ? (
                  <div className="grid gap-5 xl:grid-cols-2">
                    <div className="xl:col-span-2">
                      <DetailSection title="Summary">
                        <p className="max-w-4xl text-base leading-8 text-zinc-300">
                          {selectedPlugin.overview}
                        </p>
                      </DetailSection>
                    </div>
                    <DetailSection title="Capabilities">
                      <BulletList items={selectedPlugin.capabilities} />
                    </DetailSection>
                    <DetailSection title="Where It Appears">
                      <BulletList items={selectedPlugin.whereItAppears} />
                    </DetailSection>
                    <DetailSection title="Permissions">
                      <BulletList items={selectedPlugin.permissions} />
                    </DetailSection>
                    <DetailSection title="Getting Started">
                      <BulletList
                        items={selectedPlugin.gettingStarted}
                        numbered
                      />
                    </DetailSection>
                  </div>
                ) : null}

                {detailTab === "changelog" ? (
                  <DetailSection title="Changelog">
                    <div className="grid gap-3">
                      {selectedPlugin.changelog.length > 0 ? (
                        selectedPlugin.changelog.map((item, index) => (
                          <div
                            key={`${item}-${index}`}
                            className="rounded-2xl border border-white/8 bg-[#0b0d0f] px-4 py-4 text-sm leading-7 text-zinc-300"
                          >
                            {item}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-zinc-500">
                          No changelog has been published for this Extension yet.
                        </p>
                      )}
                    </div>
                  </DetailSection>
                ) : null}

                {detailTab === "details" ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <DetailSection title="Metadata">
                      <div className="grid gap-3 text-sm text-zinc-300">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-zinc-500">Package ID</span>
                          <span className="font-mono text-xs">
                            {selectedPlugin.id}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-zinc-500">Install root</span>
                          <span>{selectedPlugin.rootLabel ?? "public"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-zinc-500">Installed</span>
                          <span>{selectedPlugin.installed ? "yes" : "no"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-zinc-500">Launcher</span>
                          <span>
                            {selectedPlugin.launcher.views.join(", ") || "none"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-zinc-500">Open mode</span>
                          <span>{selectedPlugin.launcher.open_mode}</span>
                        </div>
                      </div>
                    </DetailSection>

                    <DetailSection title="Links">
                      <div className="grid gap-2">
                        {selectedPlugin.links.length > 0 ? (
                          selectedPlugin.links.map((link) => (
                            <button
                              key={`${selectedPlugin.id}:${link.url}`}
                              className="inline-flex items-center justify-between rounded-xl border border-white/8 bg-[#0b0d0f] px-3 py-3 text-left text-sm text-white transition hover:bg-white/[0.04]"
                              onClick={() => onOpenLink?.(link.url)}
                              type="button"
                            >
                              <span>{link.label}</span>
                              <span className="text-zinc-500">↗</span>
                            </button>
                          ))
                        ) : (
                          <p className="text-sm text-zinc-500">
                            No external links yet.
                          </p>
                        )}
                      </div>
                    </DetailSection>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              No Extensions match the current filter.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
