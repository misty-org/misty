import { cn } from "@/shared/ui";
import { Blocks, Download, LayoutGrid, SquareStar, Store } from "lucide-react";

export type MarketplaceSection = "featured" | "apps" | "extensions" | "installed";

const storeSections = [
  { id: "featured", label: "Featured", icon: SquareStar },
  { id: "apps", label: "Apps", icon: LayoutGrid },
  { id: "extensions", label: "Extensions", icon: Blocks },
  { id: "installed", label: "Installed", icon: Download },
] satisfies Array<{
  id: MarketplaceSection;
  label: string;
  icon: typeof SquareStar;
}>;

export function MarketplaceStoreNav(props: {
  active: MarketplaceSection;
  installedCount: number;
  onChange: (section: MarketplaceSection) => void;
}) {
  return (
    <aside
      aria-label="Discover navigation"
      className={cn(
        "flex h-full min-h-0 w-full flex-col border-r border-charcoal-border",
        "bg-charcoal-workspace p-3 max-[860px]:w-full max-[860px]:border-r-0",
        "max-[860px]:border-b max-[860px]:p-2",
      )}
      data-store-sidebar="true"
    >
      <div className="flex h-10 items-center gap-2 px-2 text-sm font-semibold text-cream-bright max-[860px]:hidden">
        <Store aria-hidden="true" size={18} strokeWidth={1.9} />
        <span>Discover</span>
      </div>

      <nav
        aria-label="Discover sections"
        className="mt-2 grid gap-1 max-[860px]:mt-0 max-[860px]:grid-cols-4"
      >
        {storeSections.map(({ id, label, icon: Icon }) => {
          const active = props.active === id;
          return (
            <button
              aria-current={active ? "page" : undefined}
              aria-label={`Browse ${label.toLowerCase()}`}
              className={cn(
                "flex h-9 min-w-0 items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none transition-colors",
                "max-[860px]:h-11",
                "focus-visible:border focus-visible:border-charcoal-active",
                active
                  ? "bg-charcoal-card text-cream-bright"
                  : "text-cream-muted hover:bg-charcoal-card hover:text-cream",
                "max-[560px]:justify-center max-[560px]:px-1",
              )}
              key={id}
              onClick={() => props.onChange(id)}
              type="button"
            >
              <Icon aria-hidden="true" className="shrink-0" size={17} strokeWidth={1.9} />
              <span className="truncate max-[560px]:sr-only">{label}</span>
              {id === "installed" && props.installedCount > 0 ? (
                <span className="ml-auto text-[11px] tabular-nums text-cream-muted max-[560px]:hidden">
                  {props.installedCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
