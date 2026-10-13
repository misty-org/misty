import { routes } from "@/features/app-shell";
import { useNativeSessionStore } from "@/features/native-session";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";

const appPageTitles = new Map<string, string>([
  [routes.spaces, "Misty - Spaces"],
  [routes.agents, "Misty - Agents"],
  [routes.scheduled, "Misty - Scheduled"],
  [routes.signIn, "Misty - Sign In"],
  [routes.register, "Misty - Register"],
  [routes.welcome, "Misty"],
]);

export function AppPagesLayout() {
  const location = useLocation();
  const refreshSession = useNativeSessionStore((state) => state.refreshSession);

  useEffect(() => {
    const match = [...appPageTitles.keys()]
      .sort((left, right) => right.length - left.length)
      .find((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
    document.title = match ? (appPageTitles.get(match) ?? "Misty") : "Misty";
    window.getSelection()?.removeAllRanges();
  }, [location.pathname]);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    const interval = window.setInterval(
      () => {
        void refreshSession();
      },
      10 * 60 * 1000,
    );
    return () => window.clearInterval(interval);
  }, [refreshSession]);

  return (
    <div className="app-pages-root h-full min-h-0 bg-charcoal-bg text-cream">
      <main className="h-full min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
