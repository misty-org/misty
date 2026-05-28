import { useEffect, useMemo, useState } from "react";
import type { PluginBrowserEntry, PluginBrowserTab, PluginDetailTab } from "./types";

type PluginBrowserProps = {
  title?: string;
  subtitle?: string;
  plugins: PluginBrowserEntry[];
  loading?: boolean;
  error?: string;
  notice?: string;
  query: string;
  selectedPluginId?: string;
  onQueryChange: (query: string) => void;
  onSelect: (pluginId: string) => void;
  onRefresh?: () => void;
  onInstall?: (plugin: PluginBrowserEntry) => void;
  onToggle?: (plugin: PluginBrowserEntry, enabled: boolean) => void;
  onUninstall?: (plugin: PluginBrowserEntry) => void;
  onOpenLink?: (url: string) => void;
};

function pluginStatus(plugin: PluginBrowserEntry) {
  if (!plugin.installed) {
    return "available";
  }
  return plugin.enabled ? "installed" : "disabled";
}

function statusDotClass(plugin: PluginBrowserEntry) {
  if (!plugin.installed) {
    return "bg-zinc-500";
  }
  return plugin.enabled ? "bg-white" : "bg-zinc-500";
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

function prettyPermission(permission: string) {
  const normalized = permission.toLowerCase();
  if (normalized.includes("write") || normalized.includes("shell")) {
    return "elevated";
  }
  if (normalized.includes("network")) {
    return "network";
  }
  return "read-only";
}

function categoryLabel(plugin: PluginBrowserEntry) {
  return plugin.whereItAppears[0] ?? "productivity";
}

function filterPlugins(plugins: PluginBrowserEntry[], query: string, tab: PluginBrowserTab) {
  const normalized = query.trim().toLowerCase();
  return plugins.filter((plugin) => {
    if (tab === "installed" && !plugin.installed) {
      return false;
    }
    if (!normalized) {
      return true;
    }
    return [plugin.name, plugin.author, plugin.overview, plugin.id, plugin.version]
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
  const src = plugin.logoSrc && !imgFailed ? plugin.logoSrc : "";

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

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{label}</p>
        <p className="truncate text-sm text-zinc-200">{value}</p>
      </div>
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
      <p className="text-[15px] font-semibold text-white">{title}</p>
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
        <div key={`${item}-${index}`} className="flex items-start gap-3 text-sm leading-6 text-zinc-300">
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
      className={`w-full rounded-xl border p-3 text-left transition ${
        selected
          ? "border-white/18 bg-white/[0.05]"
          : "border-white/8 bg-[#0b0d0f] hover:border-white/14 hover:bg-white/[0.03]"
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start gap-3">
        <PluginLogo
          plugin={plugin}
          roundedClass="rounded-xl"
          sizeClass="h-14 w-14"
          textClass="text-sm font-semibold text-white"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-white">{plugin.name}</p>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                <span>{plugin.author || "Misty"}</span>
                {plugin.verified ? <span className="text-zinc-300">verified</span> : null}
              </div>
            </div>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{plugin.overview}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[11px] text-zinc-300">
              <span className={`h-2 w-2 rounded-full ${statusDotClass(plugin)}`} />
              {pluginStatus(plugin)}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${statusPillClass(plugin)}`}>
              {pluginStatus(plugin)}
            </span>
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
}: {
  plugin: PluginBrowserEntry;
  busy: boolean;
  onInstall?: (plugin: PluginBrowserEntry) => void;
  onToggle?: (plugin: PluginBrowserEntry, enabled: boolean) => void;
}) {
  return (
    <button
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={busy || (!plugin.installed && !onInstall) || (plugin.installed && !onToggle)}
      onClick={() => (!plugin.installed ? onInstall?.(plugin) : onToggle?.(plugin, !plugin.enabled))}
      type="button"
    >
      {actionLabel(plugin)}
    </button>
  );
}

export function PluginBrowser({
  title = "Plugins",
  subtitle = "Extend Misty with powerful plugins.",
  plugins,
  loading = false,
  error = "",
  notice = "",
  query,
  selectedPluginId,
  onQueryChange,
  onSelect,
  onRefresh,
  onInstall,
  onToggle,
  onUninstall,
  onOpenLink,
}: PluginBrowserProps) {
  const [browserTab, setBrowserTab] = useState<PluginBrowserTab>("marketplace");
  const [detailTab, setDetailTab] = useState<PluginDetailTab>("overview");

  const visiblePlugins = useMemo(() => filterPlugins(plugins, query, browserTab), [plugins, query, browserTab]);
  const selectedPlugin =
    visiblePlugins.find((plugin) => plugin.id === selectedPluginId) ??
    plugins.find((plugin) => plugin.id === selectedPluginId) ??
    visiblePlugins[0] ??
    plugins[0];

  useEffect(() => {
    if (selectedPlugin && selectedPlugin.id !== selectedPluginId) {
      onSelect(selectedPlugin.id);
    }
  }, [onSelect, selectedPlugin, selectedPluginId]);

  const metadata = selectedPlugin
    ? [
        { label: "Version", value: selectedPlugin.version },
        { label: "Author", value: selectedPlugin.author || "Misty" },
        { label: "Category", value: categoryLabel(selectedPlugin) },
        {
          label: "Permissions",
          value: selectedPlugin.permissions[0] ? prettyPermission(selectedPlugin.permissions[0]) : "read-only",
        },
      ]
    : [];

  return (
    <div className="w-full px-6 pb-10 pt-24 sm:px-8 md:pt-28 lg:px-10">
      <div className="border-b border-white/[0.07] pb-5">
        <h1 className="text-[30px] font-semibold text-white">{title}</h1>
        <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
      </div>

      <div className="grid gap-6 pt-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-[760px] flex-col rounded-2xl border border-white/8 bg-[#090b0d]/95">
          <div className="border-b border-white/[0.07] p-3">
            <div className="flex items-center gap-2">
              <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/8 bg-[#0b0d0f] px-3">
                <span className="text-zinc-500">search</span>
                <input
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Search plugins..."
                  value={query}
                />
              </label>
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/8 bg-[#0b0d0f] text-zinc-400 transition hover:bg-white/[0.04] hover:text-white"
                onClick={() => onRefresh?.()}
                type="button"
              >
                sort
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-white/8 bg-[#0b0d0f] p-1">
              {([
                ["marketplace", "Marketplace"],
                ["installed", "Installed"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                    browserTab === value ? "bg-white text-black" : "text-zinc-400 hover:bg-white/[0.04]"
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
            <div className="grid gap-2.5">
              {visiblePlugins.map((plugin) => (
                <SidebarPluginCard
                  key={plugin.id}
                  onClick={() => onSelect(plugin.id)}
                  plugin={plugin}
                  selected={plugin.id === selectedPlugin?.id}
                />
              ))}
              {visiblePlugins.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-500">
                  No plugins match the current filter.
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-3 text-xs text-zinc-500">
            <span>{visiblePlugins.length} plugins</span>
            <button
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/[0.05] hover:text-white"
              onClick={() => onRefresh?.()}
              type="button"
            >
              {loading ? "..." : "↻"}
            </button>
          </div>
        </aside>

        <section className="min-h-[760px] rounded-2xl border border-white/8 bg-[#090b0d]/95">
          {selectedPlugin ? (
            <div className="flex h-full flex-col">
              <div className="border-b border-white/[0.07] px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="flex min-w-0 gap-5">
                    <PluginLogo
                      plugin={selectedPlugin}
                      roundedClass="rounded-2xl"
                      sizeClass="h-20 w-20"
                      textClass="text-lg font-semibold text-white"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-[28px] font-semibold text-white">{selectedPlugin.name}</h2>
                        <span className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-400">
                          {selectedPlugin.version}
                        </span>
                        <span className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-400">
                          {selectedPlugin.author || "Misty"}
                        </span>
                        {selectedPlugin.verified ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-300">
                            verified
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
                        <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(selectedPlugin)}`} />
                        <span>{pluginStatus(selectedPlugin)}</span>
                      </div>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{selectedPlugin.overview}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <PrimaryAction
                      busy={loading}
                      onInstall={onInstall}
                      onToggle={onToggle}
                      plugin={selectedPlugin}
                    />
                    <button
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300 transition hover:bg-white/[0.06]"
                      onClick={() => onRefresh?.()}
                      type="button"
                    >
                      ↻
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 border-t border-white/[0.07] pt-4 md:grid-cols-2 xl:grid-cols-4">
                  {metadata.map((item) => (
                    <MetadataRow key={item.label} label={item.label} value={item.value} />
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
                  <div className="flex items-center gap-5">
                    {([
                      ["overview", "Overview"],
                      ["changelog", "Changelog"],
                      ["details", "Details"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        className={`border-b pb-2 text-sm transition ${
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
                    {selectedPlugin.installed && onUninstall ? (
                      <button
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white transition hover:bg-white/[0.06]"
                        onClick={() => onUninstall(selectedPlugin)}
                        type="button"
                      >
                        uninstall
                      </button>
                    ) : null}
                    {selectedPlugin.links[0] && onOpenLink ? (
                      <button
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white transition hover:bg-white/[0.06]"
                        onClick={() => onOpenLink(selectedPlugin.links[0].url)}
                        type="button"
                      >
                        open link
                      </button>
                    ) : null}
                  </div>
                </div>

                {notice ? <p className="mt-4 text-sm text-zinc-300">{notice}</p> : null}
                {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5">
                {detailTab === "overview" ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="xl:col-span-2">
                      <DetailSection title="Overview">
                        <p className="max-w-3xl text-sm leading-7 text-zinc-300">{selectedPlugin.overview}</p>
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
                      <BulletList items={selectedPlugin.gettingStarted} numbered />
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
                            className="rounded-xl border border-white/8 bg-[#0b0d0f] px-3 py-3 text-sm text-zinc-300"
                          >
                            {item}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-zinc-500">No changelog has been published for this plugin yet.</p>
                      )}
                    </div>
                  </DetailSection>
                ) : null}

                {detailTab === "details" ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <DetailSection title="Metadata">
                      <div className="grid gap-3 text-sm text-zinc-300">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-zinc-500">Plugin ID</span>
                          <span className="font-mono text-xs">{selectedPlugin.id}</span>
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
                          <span>{selectedPlugin.launcher.views.join(", ") || "none"}</span>
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
                          <p className="text-sm text-zinc-500">No external links yet.</p>
                        )}
                      </div>
                    </DetailSection>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.07] px-5 py-4 text-xs text-zinc-500">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">•</span>
                  <span>Installing a plugin adds it to your local Misty plugin directory.</span>
                </div>
                <span>{selectedPlugin.installed ? "Detected locally" : "Available from catalog"}</span>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              No plugins match the current filter.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
