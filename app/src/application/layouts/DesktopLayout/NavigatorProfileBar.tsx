import { cn } from "@/shared/ui";
import { Settings } from "lucide-react";
import type { RefObject } from "react";
import { ActivityMenu } from "./ActivityMenu";
import { ProfileNavButton } from "./NavRail";

/**
 * The account dock, floating over the navigator's scrolling body.
 *
 * It sits on top of the rail rather than in the column flow so the Spaces and
 * Tools lists can scroll the full height behind it and it never scrolls away.
 * The lists reserve room for it with their own bottom padding.
 */
export function NavigatorProfileBar(props: {
  collapsed: boolean;
  profileAnchorRef: RefObject<HTMLButtonElement | null>;
  profileOpen: boolean;
  settingsOpen: boolean;
  onProfileClick: () => void;
  onSettingsClick: () => void;
}) {
  return (
    <div
      className={cn("absolute bottom-2 z-20", props.collapsed ? "inset-x-1.5" : "inset-x-2")}
      data-misty-window-drag-block="true"
    >
      <div
        className={cn(
          "flex items-center gap-1 rounded-xl border border-charcoal-border/60 bg-charcoal-card p-1",
          "shadow-[0_12px_30px_rgba(0,0,0,0.5)]",
          props.collapsed && "flex-col gap-0.5",
        )}
      >
        <ProfileNavButton
          ref={props.profileAnchorRef}
          open={props.profileOpen}
          onClick={props.onProfileClick}
          className={cn(
            "group/profile relative flex min-w-0 items-center rounded-lg border-0 bg-transparent",
            "text-sm text-cream no-underline outline-none transition-colors",
            "hover:bg-charcoal-active focus-visible:ring-2 focus-visible:ring-charcoal-active",
            props.collapsed ? "size-9 justify-center p-0" : "h-9 flex-1 justify-start gap-2 px-1.5",
            props.profileOpen && "bg-charcoal-active",
          )}
          avatarClassName="size-7 border-0 bg-transparent ring-0 group-hover/profile:ring-0"
          showAccountName={!props.collapsed}
        />
        <ActivityMenu
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg border-0 bg-transparent",
            "text-cream-muted transition-colors hover:bg-charcoal-active hover:text-cream-bright",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-active",
          )}
        />
        <button
          type="button"
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg border-0 bg-transparent",
            "text-cream-muted transition-colors hover:bg-charcoal-active hover:text-cream-bright",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-active",
            props.settingsOpen && "bg-charcoal-active text-cream-bright",
          )}
          aria-label="Settings"
          title="Settings"
          onClick={props.onSettingsClick}
        >
          <Settings size={18} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
