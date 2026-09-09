import { openAccountSettingsInBrowser } from "@/features/account";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui";
import { ArrowUpRight, ChevronRight, LogIn, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { useMobileSurfaceChrome } from "@/shared/mobile";
import { useNavigate } from "react-router-dom";
import { useAccountAvatarUrl } from "../hooks/useAccountAvatarUrl";
import { useUserStore } from "../store/useUserStore";
import { useAuth } from "../AuthContext";

export default function MobileProfilePage() {
  useMobileSurfaceChrome({ title: "Profile", level: "root" });
  const navigate = useNavigate();
  const { user, transitioning, logout } = useAuth();
  const me = useUserStore((state) => state.me);
  const [working, setWorking] = useState<"manage" | "signout" | "">("");
  const [error, setError] = useState("");
  const avatarUrl = useAccountAvatarUrl(user?.id, user?.avatarVersion);

  if (!user) {
    return (
      <ProfileScroll>
        <div className="grid min-h-[min(520px,70dvh)] place-items-center px-5 text-center">
          <div className="max-w-sm">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-charcoal-card text-cream-bright">
              <UserRound size={28} aria-hidden="true" />
            </span>
            <h1 className="mt-5 text-lg font-semibold tracking-[-0.02em] text-cream-bright">
              Sign in to Misty
            </h1>
            <p className="mt-2 text-sm leading-6 text-cream-muted">
              Access your Spaces, conversations, plans, and profile on this device.
            </p>
            <button
              type="button"
              className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-charcoal-active px-4 text-base font-semibold text-cream-bright active:bg-charcoal-card"
              onClick={() => navigate("/signin", { state: { from: "/profile" } })}
            >
              <LogIn size={19} aria-hidden="true" />
              Sign in
            </button>
            <button
              type="button"
              className="mt-2 min-h-11 w-full rounded-lg px-4 text-sm font-medium text-cream-muted active:bg-charcoal-card active:text-cream-bright"
              onClick={() => navigate("/register", { state: { from: "/profile" } })}
            >
              Create an account
            </button>
          </div>
        </div>
      </ProfileScroll>
    );
  }

  const current = me?.id === user.id ? me : null;
  const displayName = current?.name || user.name || user.email;
  const email = current?.email || user.email;
  const username = current?.username || user.username || "";
  const plan = current?.tier || user.currentPlan || "basic";
  const createdAt = current?.created_at || user.accountCreatedAt;

  const manageAccount = async () => {
    if (working || transitioning) return;
    setWorking("manage");
    setError("");
    try {
      await openAccountSettingsInBrowser("/settings/account");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account settings could not be opened.");
    } finally {
      setWorking("");
    }
  };

  const signOut = async () => {
    if (working || transitioning) return;
    setWorking("signout");
    setError("");
    try {
      await logout();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Misty could not sign you out.");
      setWorking("");
    }
  };

  return (
    <ProfileScroll>
      <div className="mx-auto w-full max-w-xl px-4 pb-8 pt-7">
        <section className="flex flex-col items-center text-center" aria-labelledby="profile-name">
          <Avatar className="size-20 bg-charcoal-card text-cream-bright">
            {avatarUrl ? (
              <AvatarImage src={avatarUrl} alt={`${displayName} profile picture`} />
            ) : null}
            <AvatarFallback className="text-lg font-semibold">
              {profileInitials(displayName, email)}
            </AvatarFallback>
          </Avatar>
          <h1
            id="profile-name"
            className="mt-4 max-w-full truncate text-lg font-semibold tracking-[-0.02em] text-cream-bright"
          >
            {displayName}
          </h1>
          <p className="mt-1 max-w-full truncate text-sm text-cream-muted">{email}</p>
          <span className="mt-3 rounded-full bg-charcoal-active px-3 py-1 text-xs font-semibold capitalize text-cream-bright">
            {plan} plan
          </span>
        </section>

        <section className="mt-8" aria-labelledby="account-details-heading">
          <h2
            id="account-details-heading"
            className="mb-2 px-1 text-xs font-semibold text-cream-muted"
          >
            Account details
          </h2>
          <div className="overflow-hidden rounded-xl border border-charcoal-border bg-charcoal-card">
            {username ? <ProfileValue label="Username" value={`@${username}`} /> : null}
            <ProfileValue label="Email" value={email} />
            <ProfileValue label="Plan" value={capitalize(plan)} />
            {createdAt ? (
              <ProfileValue label="Member since" value={formatMembershipDate(createdAt)} />
            ) : null}
          </div>
        </section>

        <section className="mt-7" aria-labelledby="account-actions-heading">
          <h2
            id="account-actions-heading"
            className="mb-2 px-1 text-xs font-semibold text-cream-muted"
          >
            Account
          </h2>
          <div className="overflow-hidden rounded-xl border border-charcoal-border bg-charcoal-card">
            <button
              type="button"
              className="flex min-h-14 w-full items-center gap-3 border-b border-charcoal-border px-4 text-left text-sm text-cream-bright disabled:opacity-50"
              disabled={Boolean(working) || transitioning}
              onClick={() => void manageAccount()}
            >
              <ArrowUpRight size={19} className="shrink-0 text-cream-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {working === "manage" ? "Opening account…" : "Manage account"}
                </span>
                <span className="mt-0.5 block text-xs text-cream-muted">Opens in your browser</span>
              </span>
              <ChevronRight size={17} className="shrink-0 text-cream-muted" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-sm font-medium text-cream-bright disabled:opacity-50"
              disabled={Boolean(working) || transitioning}
              onClick={() => void signOut()}
            >
              <LogOut size={19} className="shrink-0 text-cream-muted" aria-hidden="true" />
              {working === "signout" || transitioning ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </section>

        {error ? (
          <p
            className="mt-4 rounded-lg bg-charcoal-card px-4 py-3 text-sm text-notification-red"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </ProfileScroll>
  );
}

function ProfileScroll(props: { children: React.ReactNode }) {
  return (
    <div className="misty-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain bg-charcoal-bg">
      {props.children}
    </div>
  );
}

function ProfileValue(props: { label: string; value: string }) {
  return (
    <div className="grid min-h-14 grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] items-center gap-4 border-b border-charcoal-border px-4 last:border-b-0">
      <span className="text-sm text-cream-muted">{props.label}</span>
      <span className="truncate text-right text-sm font-medium text-cream-bright">
        {props.value}
      </span>
    </div>
  );
}

function profileInitials(name: string, email: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return initials || email[0]?.toUpperCase() || "M";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatMembershipDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}
