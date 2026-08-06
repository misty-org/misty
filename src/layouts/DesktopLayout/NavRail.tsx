import { forwardRef, memo } from "react";
import { NavLink } from "react-router-dom";
import { Bell, Settings as SettingsIcon, UserCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Avatar, AvatarFallback, AvatarImage, Button } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useAccountAvatarUrl } from "@/hooks/useAccountAvatarUrl";
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
  navItemBaseClass,
  navLinkActiveClass,
  navLinkBaseClass,
  profileDockClass,
} from "./styles";
import { emailName, formatBadgeCount, initialsForProfile } from "./helpers";

const notificationBadgeClass = [
  "absolute right-px top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#d83e3e]",
  "px-[5px] text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--misty-bg)]",
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

export const ActivityNavButton = memo(
  forwardRef<
    HTMLButtonElement,
    {
      badge: number;
      open: boolean;
      onClick: () => void;
    }
  >(function ActivityNavButton(props, ref) {
    return (
      <Button
        ref={ref}
        className={`group/nav-item ${navItemBaseClass} ${props.open ? navButtonActiveClass : ""}`}
        variant="ghost"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={props.open}
        aria-label="Activity"
        onClick={props.onClick}
      >
        <span className={`${navIconTileBaseClass} ${props.open ? navIconTileActiveClass : ""}`}>
          <Bell className={navIconClass} strokeWidth={1.85} />
          {props.badge ? (
            <span className={notificationBadgeClass}>{formatBadgeCount(props.badge)}</span>
          ) : null}
        </span>
        <span className={`${navItemLabelBaseClass} ${props.open ? navItemLabelActiveClass : ""}`}>
          Activity
        </span>
      </Button>
    );
  }),
);

export function SettingsNavButton(props: { open: boolean; onClick: () => void }) {
  return (
    <Button
      className={`group/nav-item ${navItemBaseClass} ${props.open ? navButtonActiveClass : ""}`}
      variant="ghost"
      type="button"
      aria-haspopup="dialog"
      aria-expanded={props.open}
      aria-label="Settings"
      onClick={props.onClick}
    >
      <span className={`${navIconTileBaseClass} ${props.open ? navIconTileActiveClass : ""}`}>
        <SettingsIcon className={navIconClass} strokeWidth={1.85} />
      </span>
      <span className={`${navItemLabelBaseClass} ${props.open ? navItemLabelActiveClass : ""}`}>
        Settings
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
        type="button"
        aria-label="Profile"
        aria-haspopup="menu"
        aria-expanded={props.open}
        onClick={props.onClick}
      >
        {account ? (
          <Avatar className="size-full">
            {avatarUrl ? (
              <AvatarImage src={avatarUrl} alt={`${displayName} profile picture`} />
            ) : null}
            <AvatarFallback className="font-bold text-[var(--misty-text)]">
              {initials}
            </AvatarFallback>
          </Avatar>
        ) : (
          <UserCircle size={24} strokeWidth={1.75} />
        )}
      </Button>
    );
  }),
);
