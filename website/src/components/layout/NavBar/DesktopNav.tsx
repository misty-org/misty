import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";

import { ModeToggle } from "@/components/theme/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { JOIN_HREF } from "@/lib/site";
import AccountMenu from "./AccountMenu";
import { navItems, resourceLinks } from "./navLinks";

function DesktopNavLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive && "text-foreground",
        )
      }
    >
      {label}
    </NavLink>
  );
}

export default function DesktopNav({
  currentPath,
  displayName,
  email,
  initials,
  resourcesActive,
  signedIn,
  onOpenSettings,
  onSignOut,
}: {
  currentPath: string;
  displayName: string;
  email: string;
  initials: string;
  resourcesActive: boolean;
  signedIn: boolean;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openResources = () => {
    cancelClose();
    setResourcesOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setResourcesOpen(false), 100);
  };

  useEffect(
    () => () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
      }
    },
    [],
  );

  return (
    <div className="hidden items-center gap-1 md:flex">
      {navItems.map((item) => (
        <DesktopNavLink key={item.to} {...item} />
      ))}

      <DropdownMenu open={resourcesOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            onPointerEnter={openResources}
            onPointerLeave={scheduleClose}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => event.preventDefault()}
            className={cn(
              "h-auto rounded-md bg-transparent px-2 py-1 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent dark:hover:bg-transparent",
              resourcesActive && "text-foreground",
            )}
          >
            Resources
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="center"
          sideOffset={0}
          onPointerEnter={openResources}
          onPointerLeave={scheduleClose}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="w-40"
        >
          {resourceLinks.map(({ to, label }) => (
            <DropdownMenuItem
              key={to}
              asChild
              onSelect={() => setResourcesOpen(false)}
              className="py-1"
            >
              <NavLink to={to}>{label}</NavLink>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-3 flex items-center gap-2 border-l border-border pl-4">
        <ModeToggle />

        {signedIn ? (
          <AccountMenu
            displayName={displayName}
            email={email}
            initials={initials}
            onOpenSettings={onOpenSettings}
            onSignOut={onSignOut}
          />
        ) : (
          <>
            <NavLink
              to="/signin"
              state={{ from: currentPath }}
              className="px-2 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign in
            </NavLink>
            <Button asChild size="sm" className="rounded-full px-4">
              <NavLink to={JOIN_HREF}>Join now</NavLink>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
