import { routes } from "@/features/app-shell";
import { Button } from "@/shared/ui";
import { NavLink, Outlet } from "react-router-dom";

const webNavItems = [
  { label: "Spaces", path: routes.spaces },
  { label: "Sign in", path: routes.signIn },
] as const;

/** Browser shell: intentionally free of Tauri window, setup, and OS state. */
export function WebAppFrameLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-charcoal-bg text-cream">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-charcoal-border px-4 sm:px-6">
        <NavLink className="text-sm font-semibold text-cream-bright" to={routes.spaces}>
          Misty
        </NavLink>
        <nav className="flex items-center gap-1" aria-label="Primary navigation">
          {webNavItems.map((item) => (
            <Button asChild key={item.path} size="sm" variant="ghost">
              <NavLink to={item.path}>{item.label}</NavLink>
            </Button>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
