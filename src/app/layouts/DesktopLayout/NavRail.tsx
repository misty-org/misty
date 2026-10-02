import { useAccountAvatarUrl, useAuth, useUserStore } from "@/features/auth";
import { useNativeSessionStore } from "@/features/native-session";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import { Avatar, AvatarFallback, AvatarImage, Button, cn } from "@/shared/ui";
import { UserCircle } from "lucide-react";
import { forwardRef, memo, type ButtonHTMLAttributes } from "react";
import { useShallow } from "zustand/react/shallow";
import { emailName, initialsForProfile } from "./helpers";
import { profileDockClass } from "./styles";

export const ProfileNavButton = memo(
  forwardRef<
    HTMLButtonElement,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
      open: boolean;
      /** Overrides the rail dock geometry so the navigator can align it to its rows. */
      className?: string;
      avatarClassName?: string;
      label?: string | null;
      /** Labels the button with the signed-in account's display name. */
      showAccountName?: boolean;
    }
  >(function ProfileNavButton(
    { open, className, avatarClassName, label, showAccountName, ...buttonProps },
    ref,
  ) {
    const props = { open, className, avatarClassName, label, showAccountName };
    const currentUser = useNativeSessionStore((state) => state.status?.current_user ?? null);
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
        className={cn("group/profile", props.className ?? profileDockClass)}
        variant="ghost"
        type="button"
        aria-label="Profile"
        aria-haspopup="menu"
        aria-expanded={props.open}
        {...buttonProps}
      >
        {account ? (
          <Avatar shape="tile" className={cn("shrink-0", props.avatarClassName)}>
            {avatarUrl ? (
              <AvatarImage src={avatarUrl} alt={`${displayName} profile picture`} />
            ) : null}
            <AvatarFallback
              className={cn(
                account?.id
                  ? cn(avatarColorClass(account.id), avatarInkClass)
                  : "bg-charcoal-bg text-cream",
              )}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
        ) : (
          <UserCircle
            className={cn(
              "size-6 shrink-0 text-cream-muted transition-colors group-hover/profile:text-cream",
              props.avatarClassName,
            )}
            strokeWidth={1.75}
          />
        )}
        {(props.label ?? (props.showAccountName ? displayName : null)) ? (
          <span className="min-w-0 flex-1 truncate text-left">{props.label ?? displayName}</span>
        ) : null}
      </Button>
    );
  }),
);
