import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/AuthContext";
import { useUserStore } from "@/store/userStore";
import { ModeToggle } from "@/components/mode-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/download", label: "Download" },
];

const resourceLinks = [
  { to: "/blog", label: "Blog" },
  { to: "/changelog", label: "Changelog" },
  { to: "/roadmap", label: "Roadmap" },
];

function DesktopNavLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "relative border-b border-transparent px-2 py-5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive && "text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {label}
          {isActive ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-2 -bottom-px h-px bg-foreground"
            />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

export default function Navbar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const me = useUserStore((state) => state.me);

  const displayName = me?.name ?? user?.name ?? "";
  const initials = displayName
    ? displayName
        .split(" ")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
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
            className="rounded-md text-lg font-semibold tracking-[-0.025em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Misty
          </NavLink>

          <div className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <DesktopNavLink key={item.to} {...item} />
            ))}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "relative h-16 rounded-none border-b border-transparent px-2 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground",
                    resourcesActive && "text-foreground",
                  )}
                >
                  Resources
                  {resourcesActive ? (
                    <span className="absolute inset-x-2 -bottom-px h-px bg-foreground" />
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-44">
                {resourceLinks.map(({ to, label }) => (
                  <DropdownMenuItem key={to} asChild>
                    <NavLink to={to}>{label}</NavLink>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="ml-3 flex items-center gap-2 border-l border-border pl-4">
              <ModeToggle />

              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Open account menu"
                      className="rounded-full"
                    >
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel className="font-normal">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {displayName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onOpenSettings}>Settings</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={logout}>
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <NavLink
                    to="/signin"
                    state={{ from: location.pathname }}
                    className="px-2 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Sign in
                  </NavLink>
                  <Button asChild size="sm" className="px-4">
                    <NavLink to="/waitlist">Request access</NavLink>
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 md:hidden">
            <ModeToggle />
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-controls="mobile-navigation"
              >
                {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent id="mobile-navigation" className="border-t border-border md:hidden">
          <div className="bg-background px-6 py-5 sm:px-10">
            <div className="flex flex-col gap-1">
              {navItems.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "border-b border-border px-0 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "text-foreground",
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}

              <span className="pt-5 text-sm text-foreground">
                Resources
              </span>
              {resourceLinks.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "border-b border-border px-0 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "text-foreground",
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}

              {user ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setMobileOpen(false);
                      onOpenSettings();
                    }}
                    className="mt-4 justify-start px-0 text-muted-foreground"
                  >
                    Settings
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMobileOpen(false);
                      logout();
                    }}
                    className="justify-start px-0 text-muted-foreground"
                  >
                    Sign out
                  </Button>
                </>
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Button asChild variant="outline">
                    <NavLink
                      to="/signin"
                      state={{ from: location.pathname }}
                      onClick={() => setMobileOpen(false)}
                    >
                      Sign in
                    </NavLink>
                  </Button>
                  <Button asChild>
                    <NavLink to="/waitlist" onClick={() => setMobileOpen(false)}>
                      Request access
                    </NavLink>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </nav>
    </Collapsible>
  );
}
