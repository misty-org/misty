import { Gauge, Home, Puzzle } from "lucide-react";
import { FaDiscord, FaGithub, FaXTwitter } from "react-icons/fa6";
import { NavLink, useLocation } from "react-router-dom";
import { openExternalLink } from "../../../shared/openExternalLink";

const navLinks = [
  { label: "Home", to: "/hub", icon: Home, exact: true },
  { label: "Dashboard", to: "/hub/dashboard", icon: Gauge },
  { label: "Extensions", to: "/hub/extensions", icon: Puzzle },
];

const communityLinks = [
  { label: "Discord", href: "https://discord.gg/M3EQuWcFS", icon: FaDiscord },
  { label: "GitHub", href: "https://github.com/misty-org", icon: FaGithub },
  { label: "X", href: "https://x.com/mistysys", icon: FaXTwitter },
];

function railLinkClass(isActive: boolean) {
  return `group flex h-11 w-11 items-center justify-center rounded-xl text-sm font-medium transition-all duration-200 ${
    isActive
      ? "bg-white/[0.08] text-white"
      : "text-text-muted hover:bg-white/[0.05] hover:text-white"
  }`;
}

export function HubNavbar() {
  const location = useLocation();

  async function openCommunityLink(href: string) {
    await openExternalLink(href);
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
    <aside className="glass fixed inset-y-0 right-0 z-40 hidden w-16 flex-col border-l border-border/40 md:flex">
      <div className="flex h-full flex-col px-2 py-2">
        <div className="flex flex-col items-center gap-1.5">
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
              <Icon className="h-6 w-6 shrink-0" />
            </NavLink>
          ))}
        </div>

        <div className="mt-auto pt-3">
          <div className="flex flex-col items-center gap-2 border-t border-white/8 pt-3">
            <div className="flex flex-col gap-1.5">
              {communityLinks.map(({ href, icon: Icon, label }) => (
                <button
                  aria-label={label}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
                  key={label}
                  onClick={() => {
                    void openCommunityLink(href);
                  }}
                  title={label}
                  type="button"
                >
                  <Icon className="h-7 w-7" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </aside>
    </>
  );
}
