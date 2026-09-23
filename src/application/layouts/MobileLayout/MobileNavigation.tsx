import { useEffect, useState } from "react";
import { WebsiteGroupNavigator } from "@/features/browser-workspace/WebsiteGroupNavigator";
import { requestEmbeddedBrowserSuspension } from "@/shared/platform/browserSuspensionSignal";
import { appIcons, appIconStrokeWidth } from "@/shared/ui/app-icons";
import {
  cn,
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/shared/ui";
import { PanelsTopLeft, ChevronRight, Settings, Activity, UserRound, Menu } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Destination = { id: string; label: string; path: string; icon: LucideIcon };

export function MobileNavigation(props: {
  activePath: string;
  core: Destination[];
  more: Destination[];
  account: { name: string; email: string } | null;
  onAccount: () => void;
  onNavigate: (path: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    requestEmbeddedBrowserSuspension(menuOpen, "mobile-navigation");
    return () => requestEmbeddedBrowserSuspension(false, "mobile-navigation");
  }, [menuOpen]);
  return (
    <>
      <nav
        className="grid min-h-[56px] grid-cols-4 border-t border-charcoal-border bg-charcoal-workspace pb-[env(safe-area-inset-bottom)] min-[1024px]:hidden"
        aria-label="Mobile primary"
      >
        {props.core.map((item) => (
          <MobileNavButton
            key={item.id}
            item={item}
            active={routeIsActive(props.activePath, item.path)}
            onClick={() => props.onNavigate(item.path)}
          />
        ))}
        <MobileNavButton
          item={{ id: "menu", label: "Menu", path: "", icon: Menu }}
          active={menuOpen}
          onClick={() => setMenuOpen(true)}
        />
      </nav>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="flex w-[min(340px,90vw)] flex-col gap-0 p-0 pt-[env(safe-area-inset-top)]"
        >
          <SheetHeader className="shrink-0 px-4 py-3 pr-12">
            <SheetTitle className="text-sm">Workspace navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Saved websites, tools, and your account.
            </SheetDescription>
          </SheetHeader>
          <NavigationContent
            {...props}
            onAccount={() => {
              setMenuOpen(false);
              props.onAccount();
            }}
            onNavigate={(path) => {
              setMenuOpen(false);
              props.onNavigate(path);
            }}
            onWebsiteOpen={() => setMenuOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <aside className="hidden h-full min-h-0 w-[280px] flex-col border-r border-charcoal-border bg-charcoal-workspace min-[1024px]:flex">
        <NavigationContent {...props} />
      </aside>
    </>
  );
}

function NavigationContent(
  props: Parameters<typeof MobileNavigation>[0] & { onWebsiteOpen?: () => void },
) {
  return (
    <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
      <Button
        variant="ghost"
        className="mb-3 flex min-h-16 w-full items-center gap-3 rounded-xl border border-charcoal-border bg-charcoal-card px-3 text-left active:bg-charcoal-active"
        onClick={props.onAccount}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-charcoal-active text-sm font-semibold text-cream-bright">
          {props.account ? (
            profileInitials(props.account.name, props.account.email)
          ) : (
            <UserRound size={21} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-cream-bright">
            {props.account?.name || "Sign in to Misty"}
          </span>
          <span className="mt-0.5 block truncate text-xs text-cream-muted">
            {props.account?.email || "Your browser workspace across devices"}
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-cream-muted" aria-hidden="true" />
      </Button>
      <div className="[&_button]:min-h-11">
        <WebsiteGroupNavigator onOpen={props.onWebsiteOpen} />
      </div>
      <div className="mt-3 border-t border-charcoal-border/60 pt-2 grid grid-cols-1 gap-1.5">
        {[...props.core, { id: "spaces", label: "Spaces", path: "/spaces", icon: PanelsTopLeft }, ...props.more].map((item) => {
          const Icon = item.icon;
          const active = routeIsActive(props.activePath, item.path);
          return (
            <Button
              key={item.id}
              variant="ghost"
              aria-current={active ? "page" : undefined}
              className={cn(
                "grid min-h-12 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-lg px-3 text-left text-[15px]",
                active
                  ? "bg-charcoal-active text-cream-bright"
                  : "text-cream-muted active:bg-charcoal-card",
              )}
              onClick={() => props.onNavigate(item.path)}
            >
              <Icon size={19} aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function profileInitials(name: string, email: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return initials || email[0]?.toUpperCase() || "M";
}

function MobileNavButton(props: { item: Destination; active: boolean; onClick: () => void }) {
  const Icon = props.item.icon;
  return (
    <Button
      variant="ghost"
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "grid min-h-14 min-w-0 grid-rows-[28px_16px] place-items-center pt-1 text-[10px] font-medium",
        props.active ? "text-cream-bright" : "text-cream-muted active:text-cream-bright",
      )}
      onClick={props.onClick}
    >
      <Icon size={21} strokeWidth={appIconStrokeWidth} aria-hidden="true" />
      <span className="max-w-full truncate px-1">{props.item.label}</span>
    </Button>
  );
}

export const mobileNavigationIcons = {
  home: appIcons.home,
  agents: appIcons.agents,
  files: appIcons.files,
  activity: Activity,
  settings: Settings,
};

function routeIsActive(current: string, target: string): boolean {
  return Boolean(target && (current === target || current.startsWith(`${target}/`)));
}
