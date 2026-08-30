import { useEffect, useState } from "react";
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

const COMPACT_WIDTH_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
const EXPAND_WIDTH_EASING = "cubic-bezier(0.8, 0, 0.6, 1)";

function useCompactNav(threshold = 60) {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.scrollY > threshold,
  );

  useEffect(() => {
    function onScroll() {
      setCompact(window.scrollY > threshold);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return compact;
}

export default function Navbar({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user, sessionReady, logout } = useAuth();
  const me = useUserStore((state) => state.me);
  const compact = useCompactNav(60);

  const displayName = me?.name ?? user?.name ?? "";
  const initials = displayName
    ? toInitials(displayName)
    : (user?.email?.[0]?.toUpperCase() ?? "?");
  const resourcesActive = resourceLinks.some(({ to }) =>
    location.pathname.startsWith(to),
  );

  return (
    <Collapsible open={mobileOpen} onOpenChange={setMobileOpen} asChild>
      <nav
        aria-label="Primary navigation"
        className="pointer-events-none sticky inset-x-0 top-0 z-50 flex justify-center px-[var(--site-gutter)] py-3"
      >
        {sessionReady ? (
          <div
            className="pointer-events-auto w-full will-change-[max-width]"
            style={{
              // The expanded border follows the same content edges as every
              // site container, while the compact state keeps its own width.
              maxWidth: compact ? "820px" : "var(--site-content-max)",
              transition: `max-width 0.45s ${
                compact ? COMPACT_WIDTH_EASING : EXPAND_WIDTH_EASING
              }`,
            }}
          >
            <div
              className="rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)] backdrop-blur-xl"
            >
              <div
                className="flex h-12 items-center justify-between px-5"
              >
                <NavLink
                  to="/"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Misty home"
                  className="flex items-center gap-3 rounded-md text-base font-semibold tracking-[-0.02em] text-[var(--marketing-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--marketing-border-strong)]"
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
                  onSignOut={() => logout()}
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

              {!compact && (
                <MobileNav
                  currentPath={location.pathname}
                  signedIn={Boolean(user)}
                  onClose={() => setMobileOpen(false)}
                  onOpenSettings={onOpenSettings}
                  onSignOut={() => logout()}
                />
              )}
            </div>
          </div>
        ) : null}
      </nav>
    </Collapsible>
  );
}
