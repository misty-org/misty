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
  { to: "/download", label: "Download" },
  { to: "/pricing", label: "Pricing" },
];

const resourceLinks = [
  { to: "/features", label: "Features" },
  { to: "/changelog", label: "Changelog" },
  { to: "/blog", label: "Blog" },
  { to: "/roadmap", label: "Roadmap" },
];

function DesktopNavLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "relative rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive && "text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {label}
          {isActive ? (
            <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" />
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

  return (
    <Collapsible open={mobileOpen} onOpenChange={setMobileOpen} asChild>
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div
          style={{
            maxWidth: location.pathname === "/" ? "1060px" : "100%",
            transition: "max-width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          className="mx-auto flex h-16 w-full items-center justify-between px-3 sm:px-4"
        >
          <NavLink
            to="/"
            onClick={() => setMobileOpen(false)}
            aria-label="Misty home"
            className="flex items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img src="/misty.png" alt="" className="size-13" />
            <span className="text-lg font-semibold tracking-tight text-foreground">
              Misty
            </span>
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
                    "relative px-3 text-muted-foreground hover:text-foreground",
                    resourcesActive && "text-foreground",
                  )}
                >
                  Resources
                  {resourcesActive ? (
                    <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" />
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

            <div className="ml-3 flex items-center gap-2 border-l border-border pl-3">
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
                <Button asChild size="sm">
                  <NavLink to="/signin" state={{ from: location.pathname }}>
                    Sign In
                  </NavLink>
                </Button>
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
          <div className="bg-background px-4 py-4">
            <div className="flex flex-col gap-1">
              {navItems.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      isActive && "bg-accent text-accent-foreground",
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}

              <span className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                Resources
              </span>
              {resourceLinks.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "rounded-md px-5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      isActive && "bg-accent text-accent-foreground",
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
                    className="mt-2 justify-start px-3 text-muted-foreground"
                  >
                    Settings
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMobileOpen(false);
                      logout();
                    }}
                    className="justify-start px-3 text-muted-foreground"
                  >
                    Sign out
                  </Button>
                </>
              ) : (
                <Button asChild className="mt-2">
                  <NavLink
                    to="/signin"
                    state={{ from: location.pathname }}
                    onClick={() => setMobileOpen(false)}
                  >
                    Sign In
                  </NavLink>
                </Button>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </nav>
    </Collapsible>
  );
}
