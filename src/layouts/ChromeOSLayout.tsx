import { ArrowUpDown, Folder, PlugZap, Settings, UserCircle } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

const chromeOsNavItems = [
  { label: "Files", path: "/files", icon: Folder },
  { label: "Remotes", path: "/providers", icon: PlugZap },
  { label: "Transfers", path: "/transfers", icon: ArrowUpDown },
  { label: "Account", path: "/account", icon: UserCircle },
  { label: "Settings", path: "/account/settings", icon: Settings },
];

export function ChromeOSLayout() {
  const location = useLocation();

  return (
    <main className="grid h-[100dvh] min-h-0 min-w-0 grid-cols-[76px_minmax(0,1fr)] overflow-hidden bg-[var(--misty-app-frame-bg,var(--misty-bg))] text-[var(--misty-text)]">
      <aside className="flex min-h-0 flex-col items-center border-r border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-2 py-4">
        <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] text-lg font-black text-[var(--misty-text)]">
          M
        </div>
        <nav className="grid w-full gap-2" aria-label="Primary">
          {chromeOsNavItems.map((item) => {
            const Icon = item.icon;
            const active = item.path === "/account"
              ? location.pathname.startsWith("/account") && !location.pathname.startsWith("/account/settings")
              : location.pathname.startsWith(item.path);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                aria-label={item.label}
                title={item.label}
                className={`grid h-12 w-full place-items-center rounded-xl text-[var(--misty-text-muted)] no-underline transition hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)] ${active ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : ""}`}
              >
                <Icon size={22} strokeWidth={1.8} />
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <section className="min-h-0 min-w-0 overflow-hidden">
        <Outlet />
      </section>
    </main>
  );
}
