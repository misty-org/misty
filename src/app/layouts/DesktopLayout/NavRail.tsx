import { useAccountAvatarUrl, useAuth, useUserStore } from "@/features/account";
import { useNativeSessionStore } from "@/features/account";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  PresenceFace,
  Text,
  cn,
  type AvatarSize,
  type MemberPresence,
} from "@misty/ui";
import { UserCircle } from "lucide-react";
import { forwardRef, memo, type ButtonHTMLAttributes } from "react";
import { useShallow } from "zustand/react/shallow";
import { emailName, initialsForProfile } from "./accountMenuText";
import { profileDockClass } from "./styles";

/** The signed-in account as it shows: its id, name, initials and picture. */
function useAccountFace() {
  const currentUser = useNativeSessionStore((state) => state.status?.current_user ?? null);
  const { user } = useAuth();
  const me = useUserStore(
    useShallow((state) => ({
      id: state.me?.id,
      email: state.me?.email,
      username: state.me?.username,
      avatarVersion: state.me?.avatar_version ?? 0,
    })),
  );
  const account = user ?? currentUser;
  const accountMe = me.id === account?.id ? me : null;
  const email = accountMe?.email ?? account?.email ?? "";
  const displayName = accountMe?.username ?? account?.username ?? emailName(email) ?? "Misty";
  const initials = initialsForProfile(displayName, email);
  const avatarVersion = accountMe?.avatarVersion ?? user?.avatarVersion ?? 0;
  const avatarUrl = useAccountAvatarUrl(account?.id, avatarVersion);
  return { accountId: account?.id, signedIn: Boolean(account), displayName, initials, avatarUrl };
}

/**
 * The signed-in person's own face: their picture, or their initials in their own tone. The profile
 * row and the sidebar's Personal toggle both wear it.
 */
export function AccountAvatar(props: { size?: AvatarSize; className?: string }) {
  const face = useAccountFace();
  return (
    <Avatar shape="tile" size={props.size} className={cn("shrink-0", props.className)}>
      {face.avatarUrl ? (
        <AvatarImage src={face.avatarUrl} alt={`${face.displayName} profile picture`} />
      ) : null}
      <AvatarFallback
        className={face.accountId ? cn(avatarColorClass(face.accountId), avatarInkClass) : undefined}
      >
        {face.initials}
      </AvatarFallback>
    </Avatar>
  );
}

export const AccountNavButton = memo(
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
      /** How the person shows to others, as a dot on their face. */
      presence?: MemberPresence;
      /** The person's custom status, a quiet line under their name. */
      line?: string;
    }
  >(function AccountNavButton(
    { open, className, avatarClassName, label, showAccountName, presence, line, ...buttonProps },
    ref,
  ) {
    const props = { open, className, avatarClassName, label, showAccountName, presence, line };
    const face = useAccountFace();
    const avatar = <AccountAvatar className={props.avatarClassName} />;
    const name = props.label ?? (props.showAccountName ? face.displayName : null);

    return (
      <Button
        ref={ref}
        className={cn("group/profile", props.className ?? profileDockClass)}
        variant="quiet"
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={props.open}
        {...buttonProps}
      >
        {face.signedIn ? (
          props.presence ? (
            <PresenceFace presence={props.presence} ring="sidebar">
              {avatar}
            </PresenceFace>
          ) : (
            avatar
          )
        ) : (
          <UserCircle className="shrink-0 transition-colors" />
        )}
        {name ? (
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <Text tone="default">{name}</Text>
            {props.line ? (
              <Text size="caption" tone="muted">
                {props.line}
              </Text>
            ) : null}
          </span>
        ) : null}
      </Button>
    );
  }),
);
