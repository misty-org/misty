import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { navItems, resourceLinks, type NavLinkEntry } from "./navLinks";

const mobileLinkClass =
  "border-b border-border px-0 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function MobileNavLink({
  link,
  onNavigate,
}: {
  link: NavLinkEntry;
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={link.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(mobileLinkClass, isActive && "text-foreground")
      }
    >
      {link.label}
    </NavLink>
  );
}

export default function MobileNav({
  currentPath,
  signedIn,
  onClose,
  onOpenSettings,
  onSignOut,
}: {
  currentPath: string;
  signedIn: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  return (
    <CollapsibleContent
      id="mobile-navigation"
      className="border-t border-border md:hidden"
    >
      <div className="bg-background px-6 py-5 sm:px-10">
        <div className="flex flex-col gap-1">
          {navItems.map((link) => (
            <MobileNavLink key={link.to} link={link} onNavigate={onClose} />
          ))}

          <span className="pt-5 text-sm text-foreground">Resources</span>
          {resourceLinks.map((link) => (
            <MobileNavLink key={link.to} link={link} onNavigate={onClose} />
          ))}

          {signedIn ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="mt-4 justify-start px-0 text-muted-foreground"
              >
                Settings
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  onClose();
                  onSignOut();
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
                  state={{ from: currentPath }}
                  onClick={onClose}
                >
                  Sign in
                </NavLink>
              </Button>
              <Button asChild>
                <NavLink to="/signin" onClick={onClose}>
                  Join now
                </NavLink>
              </Button>
            </div>
          )}
        </div>
      </div>
    </CollapsibleContent>
  );
}
