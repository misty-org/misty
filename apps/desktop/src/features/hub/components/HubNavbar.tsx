import { BookOpen, Gauge, Home, Package2, User2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { FaDiscord, FaGithub, FaXTwitter } from "react-icons/fa6";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../AuthContext";
import hubLogo from "../media/misty-hub.png";
import { useSetupStore } from "../store/useSetupStore";
import { useUserStore } from "../store/userStore";

const navLinks = [
  { label: "Home", to: "/hub", icon: Home, exact: true },
  { label: "Dashboard", to: "/hub/dashboard", icon: Gauge },
  { label: "Docs", to: "/hub/docs", icon: BookOpen },
  { label: "Plugins", to: "/hub/plugins", icon: Package2 },
];

const communityLinks = [
  { label: "Discord", href: "https://discord.gg/M3EQuWcFS", icon: FaDiscord },
  { label: "GitHub", href: "https://github.com/misty-org", icon: FaGithub },
  { label: "X", href: "https://x.com/mistysys", icon: FaXTwitter },
];

function railLinkClass(isActive: boolean) {
  return `group flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-medium transition-all duration-200 ${
    isActive
      ? "bg-white/[0.08] text-white"
      : "text-text-muted hover:bg-white/[0.05] hover:text-white"
  }`;
}

export function HubNavbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = useSetupStore((state) => state.status?.current_user ?? null);
  const { user, logout } = useAuth();
  const me = useUserStore(useShallow((state) => ({
    email: state.me?.email,
    name: state.me?.name,
  })));
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const account = currentUser ?? user;
  const displayName = me?.name ?? account?.name ?? "";
  const initials = displayName
    ? displayName
        .split(" ")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : (account?.email?.[0]?.toUpperCase() ?? "");

  useEffect(() => {
    if (!profileOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [profileOpen]);

  async function openCommunityLink(href: string) {
    try {
      await invoke("open_external_url", { url: href });
    } catch {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <>
    <nav className="glass fixed left-20 right-0 top-0 z-40 flex h-14 items-center gap-2 overflow-x-auto border-b border-border/40 px-3 md:hidden" aria-label="Misty Hub">
      {navLinks.map(({ label, to, icon: Icon, exact }) => {
        const selected = exact ? location.pathname === to : location.pathname.startsWith(to);
        return (
          <NavLink
            aria-label={label}
            className={selected
              ? "inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-white/[0.08] px-3 text-sm font-semibold text-white"
              : "inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-white/[0.05] hover:text-white"}
            key={label}
            title={label}
            to={to}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{label}</span>
          </NavLink>
        );
      })}
    </nav>
    <aside className="glass fixed inset-y-0 right-0 z-40 hidden w-20 flex-col border-l border-border/40 md:flex">
      <div className="flex h-full flex-col px-3 py-4">
        <div className="flex items-center justify-center">
          <Link
            aria-label="Misty Hub Home"
            className="flex min-w-0 items-center justify-center transition hover:text-white"
            title="Misty Hub"
            to="/hub"
          >
            <img
              alt="Misty Hub logo"
              className="h-11 w-11 shrink-0"
              src={hubLogo}
            />
          </Link>
        </div>

        <div className="mt-8 flex flex-col items-center gap-2">
          {navLinks.map(({ label, to, icon: Icon, exact }) => (
            <NavLink
              aria-label={label}
              key={label}
              className={({ isActive }) =>
                railLinkClass(exact ? location.pathname === to : isActive)
              }
              title={label}
              to={to}
            >
              <Icon className="h-5 w-5 shrink-0" />
            </NavLink>
          ))}
        </div>

        <div className="mt-auto pt-6">
          <div className="flex flex-col items-center gap-4 border-t border-white/8 pt-4">
            <div className="flex flex-col gap-3">
              {communityLinks.map(({ href, icon: Icon, label }) => (
                <button
                  aria-label={label}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl text-text-muted transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
                  key={label}
                  onClick={() => {
                    void openCommunityLink(href);
                  }}
                  title={label}
                  type="button"
                >
                  <Icon className="h-6 w-6" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-4" ref={profileMenuRef}>
          {account ? (
            <div className="relative">
              <button
                aria-label="Account menu"
                className="flex w-full items-center justify-center border-t border-white/8 px-0 py-4 text-left transition hover:bg-white/[0.03]"
                onClick={() => setProfileOpen((value) => !value)}
                title={displayName || account.email || "Account"}
                type="button"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-base font-semibold text-black">
                  {initials}
                </span>
              </button>

              {profileOpen ? (
                <div className="absolute bottom-0 right-full mr-3 w-48">
                  <div className="glass-card overflow-hidden rounded-2xl shadow-xl shadow-black/30">
                    <Link
                      className="block px-4 py-3 text-sm text-text-muted transition hover:bg-white/[0.04] hover:text-text"
                      onClick={() => setProfileOpen(false)}
                      to="/hub/account"
                    >
                      Account
                    </Link>
                    <button
                      className="w-full border-t border-border/30 px-4 py-3 text-left text-sm text-text-muted transition hover:bg-white/[0.04] hover:text-text"
                      onClick={logout}
                      type="button"
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <button
              aria-label="Sign in"
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black transition hover:bg-zinc-200"
              onClick={() =>
                navigate("/hub/signin", { state: { from: location.pathname } })
              }
              title="Sign in"
              type="button"
            >
              <User2 className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </aside>
    </>
  );
}
