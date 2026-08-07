import { forwardRef, memo } from "react";
import { NavLink } from "react-router-dom";
import { Settings as SettingsIcon, UserCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Avatar, AvatarFallback, AvatarImage, Button, cn } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useAccountAvatarUrl } from "@/hooks/useAccountAvatarUrl";
import { avatarColorClass, avatarInkClass } from "@/lib/avatarPalette";
import { useSetupStore } from "@/stores/app";
import { useUserStore } from "@/stores/account/useUserStore";
import type { DesktopNavItem } from "@/models/types/layouts";
import {
  navIconClass,
  navIconTileActiveClass,
  navIconTileBaseClass,
  navItemLabelActiveClass,
  navItemLabelBaseClass,
  navButtonActiveClass,
  navIconOnlyItemBaseClass,
  navLinkActiveClass,
  navLinkBaseClass,
  profileDockClass,
} from "./styles";
import { emailName, formatBadgeCount, initialsForProfile } from "./helpers";

const notificationBadgeClass = [
  "absolute right-px top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-status-green",
  "px-[5px] text-[10px] font-bold leading-none text-cream-bright ring-2 ring-charcoal-workspace",
].join(" ");

export function NavGroup(props: {
  items: DesktopNavItem[];
  badges?: Partial<Record<string, number>>;
  currentPath: string;
  routeOverrides?: Partial<Record<string, string>>;
}) {
  return (
    <>
      {props.items.map((item) => {
        const Icon = item.icon;
        const selected = isNavItemActive(item, props.currentPath);
        return (
          <NavLink
            aria-current={selected ? "page" : undefined}
            aria-label={item.label}
            className={`group/nav-item ${navLinkBaseClass} ${selected ? navLinkActiveClass : ""}`}
            end={item.exact}
            key={item.id}
            to={props.routeOverrides?.[item.id] ?? item.path}
          >
            <span className={`${navIconTileBaseClass} ${selected ? navIconTileActiveClass : ""}`}>
              <Icon className={navIconClass} strokeWidth={1.85} />
              {props.badges?.[item.id] ? (
                <span className={notificationBadgeClass}>
                  {formatBadgeCount(props.badges[item.id] ?? 0)}
                </span>
              ) : null}
            </span>
            <span className={`${navItemLabelBaseClass} ${selected ? navItemLabelActiveClass : ""}`}>
              {item.label}
            </span>
          </NavLink>
        );
      })}
    </>
  );
}

function isNavItemActive(item: DesktopNavItem, pathname: string): boolean {
  if (item.active) return item.active(pathname);
  if (item.exact) return pathname === item.path;
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export function SettingsNavButton(props: { open: boolean; onClick: () => void }) {
  return (
    <Button
      className={`group/nav-item ${navIconOnlyItemBaseClass} ${props.open ? navButtonActiveClass : ""}`}
      variant="ghost"
      type="button"
      aria-haspopup="dialog"
      aria-expanded={props.open}
      aria-label="Settings"
      onClick={props.onClick}
    >
      <span className={`${navIconTileBaseClass} ${props.open ? navIconTileActiveClass : ""}`}>
        <SettingsIcon className="size-7" strokeWidth={1.85} />
      </span>
    </Button>
  );
}

export const ProfileNavButton = memo(
  forwardRef<
    HTMLButtonElement,
    {
      open: boolean;
      onClick: () => void;
    }
  >(function ProfileNavButton(props, ref) {
    const currentUser = useSetupStore((state) => state.status?.current_user ?? null);
    const { user } = useAuth();
    const me = useUserStore(
      useShallow((state) => ({
        id: state.me?.id,
        email: state.me?.email,
        name: state.me?.name,
        avatarVersion: state.me?.avatar_version ?? 0,
      })),
    );
    const account = user ?? currentUser;
    const accountMe = me.id === account?.id ? me : null;
    const email = accountMe?.email ?? account?.email ?? "";
    const displayName = accountMe?.name ?? account?.name ?? emailName(email) ?? "Misty";
    const initials = initialsForProfile(displayName, email);
    const avatarVersion = accountMe?.avatarVersion ?? user?.avatarVersion ?? 0;
    const avatarUrl = useAccountAvatarUrl(account?.id, avatarVersion);

    return (
      <Button
        ref={ref}
        className={profileDockClass}
        variant="ghost"
        type="button"
        aria-label="Profile"
        aria-haspopup="menu"
        aria-expanded={props.open}
        onClick={props.onClick}
      >
        {account ? (
          <Avatar
            className={cn(
              "size-9 shrink-0 rounded-full transition duration-150",
              props.open
                ? "ring-2 ring-cream/70"
                : "ring-1 ring-charcoal-border/55 group-hover/profile:ring-charcoal-border",
            )}
          >
            {avatarUrl ? (
              <AvatarImage src={avatarUrl} alt={`${displayName} profile picture`} />
            ) : null}
            <AvatarFallback
              className={cn(
                "rounded-full text-[10px] font-bold",
                account?.id ? cn(avatarColorClass(account.id), avatarInkClass) : "bg-charcoal-bg text-cream",
              )}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
        ) : (
          <UserCircle className="size-6 text-cream-muted transition-colors group-hover/profile:text-cream" strokeWidth={1.75} />
        )}
      </Button>
    );
  }),
);
