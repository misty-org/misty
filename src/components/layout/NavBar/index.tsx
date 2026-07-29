import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { Menu, X } from "lucide-react";

import { useAuth } from "@/AuthContext";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toInitials } from "@/lib/format";
import { useUserStore } from "@/store/userStore";
import DesktopNav from "./DesktopNav";
import MobileNav from "./MobileNav";
import { resourceLinks } from "./navLinks";

export default function Navbar({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user, sessionReady, logout } = useAuth();
  const me = useUserStore((state) => state.me);

  const displayName = me?.name ?? user?.name ?? "";
  const initials = displayName
    ? toInitials(displayName)
    : (user?.email?.[0]?.toUpperCase() ?? "?");
  const resourcesActive = resourceLinks.some(({ to }) =>
    location.pathname.startsWith(to),
  );
  const isHome = location.pathname === "/";

  return (
    <Collapsible open={mobileOpen} onOpenChange={setMobileOpen} asChild>
      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
      >
        {sessionReady ? (
          <div className="navbar-transition">
            {/*
             * The bar narrows to a centered column on home and expands to full
             * width on every other route. The reduced-motion rule in index.css
             * overrides this transition-duration, so the change is instant there.
             */}
            <div
              style={{
                maxWidth: isHome ? "1060px" : "100%",
                transition: "max-width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
              className="mx-auto flex h-16 w-full items-center justify-between px-6 sm:px-10 lg:px-16"
            >
              <NavLink
                to="/"
                onClick={() => setMobileOpen(false)}
                aria-label="Misty home"
                className="flex items-center gap-4 rounded-md text-lg font-semibold tracking-[-0.025em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BrandLogo />
                <span>Misty</span>
              </NavLink>

              <DesktopNav
                currentPath={location.pathname}
                displayName={displayName}
                email={user?.email ?? ""}
                initials={initials}
                resourcesActive={resourcesActive}
                signedIn={Boolean(user)}
                onOpenSettings={onOpenSettings}
                onSignOut={logout}
              />

              <div className="flex items-center gap-1 md:hidden">
                <ModeToggle />
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      mobileOpen
                        ? "Close navigation menu"
                        : "Open navigation menu"
                    }
                    aria-controls="mobile-navigation"
                  >
                    {mobileOpen ? (
                      <X aria-hidden="true" />
                    ) : (
                      <Menu aria-hidden="true" />
                    )}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>

            <MobileNav
              currentPath={location.pathname}
              signedIn={Boolean(user)}
              onClose={() => setMobileOpen(false)}
              onOpenSettings={onOpenSettings}
              onSignOut={logout}
            />
          </div>
        ) : null}
      </nav>
    </Collapsible>
  );
}
