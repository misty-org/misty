import { cn } from "@/shared/ui";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Blocks,
  ChevronRight,
  FolderOpen,
  LayoutGrid,
  PanelsTopLeft,
  ShieldCheck,
} from "lucide-react";
import { MarketplaceCatalogIcon } from "./MarketplaceCatalogIcon";
import { MarketplaceCompactCard } from "./MarketplaceCompactCard";
import {
  MarketplacePrimaryAction,
  type MarketplaceActionHandlers,
} from "./MarketplacePrimaryAction";
import type { MarketplaceSection } from "./MarketplaceStoreNav";
import type { MarketplaceEntry } from "./types";

export function MarketplaceHome({
  apps,
  busy,
  onNavigate,
  onSelect,
  ...actions
}: MarketplaceActionHandlers & {
  apps: MarketplaceEntry[];
  busy: boolean;
  onNavigate: (section: MarketplaceSection) => void;
  onSelect: (pluginId: string) => void;
}) {
  const installableApps = apps.filter((plugin) => plugin.kind === "app");
  const builtInApps = apps.filter((plugin) => plugin.kind === "builtin");
  const featured =
    installableApps.find((plugin) => normalizeId(plugin.id) === "storage_report") ??
    installableApps[0] ??
    builtInApps[0];
  const featuredApps = installableApps.slice(0, 4);
  const essentialApps = builtInApps.slice(0, 4);

  return (
    <div className="grid gap-5 pb-3">
      {featured ? (
        <section
          aria-labelledby="featured-app-title"
          className={cn(
            "grid min-h-[242px] grid-cols-[minmax(280px,0.82fr)_minmax(380px,1.18fr)]",
            "overflow-hidden rounded-xl border border-charcoal-border bg-charcoal-card",
            "max-[1120px]:grid-cols-1",
          )}
        >
          <div className="flex min-w-0 flex-col p-6 max-[640px]:p-4">
            <div className="flex items-center gap-3">
              <MarketplaceCatalogIcon
                className="size-12"
                logoSrc={featured.logoSrc}
                pluginId={featured.id}
                pluginName={featured.name}
                roundedClassName="rounded-lg"
              />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h2
                    className="truncate text-lg font-semibold text-cream-bright"
                    id="featured-app-title"
                  >
                    {featured.name}
                  </h2>
                  <Badge className="shrink-0 text-[10px]" variant="outline">
                    Featured
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-cream-muted">
                  {featured.author || "Misty"} · v{featured.version} · App
                </p>
              </div>
            </div>
            <p className="mt-4 max-w-[44ch] text-sm leading-6 text-cream-muted">
              {featured.overview}
            </p>
            <MarketplacePrimaryAction
              busy={busy}
              className="mt-auto w-fit"
              plugin={featured}
              {...actions}
            />
          </div>

          <button
            aria-label={`View ${featured.name} details`}
            className={cn(
              "m-4 grid min-h-[200px] grid-cols-[minmax(0,1fr)_168px] overflow-hidden",
              "rounded-lg border border-charcoal-border bg-charcoal-bg text-left outline-none",
              "transition-colors hover:border-charcoal-active focus-visible:border-charcoal-active",
              "max-[640px]:m-3 max-[640px]:grid-cols-1",
            )}
            onClick={() => onSelect(featured.id)}
            type="button"
          >
            <div className="min-w-0 p-5">
              <p className="text-xs font-medium text-cream">Inside {featured.name}</p>
              <div className="mt-4 grid gap-3">
                {featured.capabilities.slice(0, 3).map((capability) => (
                  <div
                    className="grid grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5"
                    key={capability}
                  >
                    <FolderOpen aria-hidden="true" className="text-cream-muted" size={16} />
                    <p className="truncate text-xs text-cream-muted">{capability}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col justify-center border-l border-charcoal-border p-5 max-[640px]:border-l-0 max-[640px]:border-t">
              <PanelsTopLeft
                aria-hidden="true"
                className="text-cream"
                size={24}
                strokeWidth={1.7}
              />
              <p className="mt-3 text-xs font-medium text-cream">Where it appears</p>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-cream-muted">
                {featured.whereItAppears.join(", ") || featured.placement.views.join(", ")}
              </p>
              {featured.verified ? (
                <span className="mt-3 flex items-center gap-1.5 text-[11px] text-sage-fg">
                  <ShieldCheck aria-hidden="true" size={13} />
                  Verified catalog entry
                </span>
              ) : null}
            </div>
          </button>
        </section>
      ) : null}

      <section aria-label="Browse Store categories" className="grid gap-3 md:grid-cols-2">
        <CategoryCard
          description="Built-in and installable tools that open in your Misty workspace."
          icon={LayoutGrid}
          label="Browse apps"
          onClick={() => onNavigate("apps")}
        />
        <CategoryCard
          description="Add new capabilities to customize and extend your workspace."
          icon={Blocks}
          label="Explore extensions"
          onClick={() => onNavigate("extensions")}
        />
      </section>

      <StoreShelf
        actionLabel="View all apps"
        empty="No installable apps are available for this device yet."
        entries={featuredApps}
        onAction={() => onNavigate("apps")}
        title="Featured apps"
      >
        {(plugin) => (
          <MarketplaceCompactCard
            busy={busy}
            key={plugin.id}
            onOpenDetails={() => onSelect(plugin.id)}
            plugin={plugin}
            {...actions}
          />
        )}
      </StoreShelf>

      <StoreShelf
        actionLabel="View all apps"
        empty="No built-in apps are available."
        entries={essentialApps}
        onAction={() => onNavigate("apps")}
        title="Essential apps"
      >
        {(plugin) => (
          <MarketplaceCompactCard
            busy={busy}
            key={plugin.id}
            onOpenDetails={() => onSelect(plugin.id)}
            plugin={plugin}
            {...actions}
          />
        )}
      </StoreShelf>
    </div>
  );
}

function CategoryCard(props: {
  label: string;
  description: string;
  icon: typeof LayoutGrid;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      className={cn(
        "group grid min-h-36 grid-cols-[48px_minmax(0,1fr)] gap-4 rounded-xl",
        "border border-charcoal-border bg-charcoal-card p-5 text-left outline-none",
        "transition-colors hover:bg-charcoal-hover/45 focus-visible:border-charcoal-active",
      )}
      onClick={props.onClick}
      type="button"
    >
      <span className="grid size-12 place-items-center rounded-lg border border-charcoal-border bg-charcoal-bg text-cream">
        <Icon aria-hidden="true" size={23} strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-cream-bright">{props.label}</span>
        <span className="mt-1 block max-w-[44ch] text-xs leading-5 text-cream-muted">
          {props.description}
        </span>
        <span
          className={cn(
            "mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border",
            "border-charcoal-border bg-charcoal-bg px-2.5 text-xs font-medium text-cream",
            "transition-colors group-hover:border-charcoal-active group-hover:text-cream-bright",
          )}
        >
          Explore
          <ChevronRight aria-hidden="true" size={14} />
        </span>
      </span>
    </button>
  );
}

function StoreShelf(props: {
  title: string;
  actionLabel: string;
  empty: string;
  entries: MarketplaceEntry[];
  onAction: () => void;
  children: (entry: MarketplaceEntry) => React.ReactNode;
}) {
  return (
    <section aria-labelledby={`marketplace-${slug(props.title)}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2
          className="text-sm font-medium text-cream-bright"
          id={`marketplace-${slug(props.title)}`}
        >
          {props.title}
        </h2>
        <Button
          className="h-7 gap-1 px-1.5 text-xs text-cream-muted"
          onClick={props.onAction}
          size="sm"
          variant="ghost"
        >
          {props.actionLabel}
          <ChevronRight aria-hidden="true" size={14} />
        </Button>
      </div>
      {props.entries.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {props.entries.map(props.children)}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-charcoal-border px-4 py-8 text-center text-xs text-cream-muted">
          {props.empty}
        </p>
      )}
    </section>
  );
}

function normalizeId(id: string) {
  return id.trim().toLowerCase().replace(/-/g, "_");
}

function slug(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-");
}
