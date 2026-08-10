import { routes } from "@/features/app-shell";
import { useSetupStore } from "@/features/installer";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";

const appPageTitles = new Map<string, string>([
  [routes.home, "Misty - Home"],
  [routes.files, "Misty - Files"],
  [routes.code, "Misty - Code"],
  [routes.extensions, "Misty - Extensions"],
  [routes.spaces, "Misty - Spaces"],
  [routes.agents, "Misty - Agents"],
  [routes.changelog, "Misty - Changelog"],
  [routes.signIn, "Misty - Sign In"],
  [routes.register, "Misty - Register"],
  [routes.account, "Misty - Account"],
  [routes.transfers, "Misty - Transfers"],
]);

export function AppPagesLayout() {
  const location = useLocation();
  const refreshLocalAccessToken = useSetupStore((state) => state.refreshLocalAccessToken);

  useEffect(() => {
    const match = [...appPageTitles.keys()]
      .sort((left, right) => right.length - left.length)
      .find((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
    document.title = match ? (appPageTitles.get(match) ?? "Misty") : "Misty";
    window.getSelection()?.removeAllRanges();
  }, [location.pathname]);

  useEffect(() => {
    const interval = window.setInterval(
      () => {
        void refreshLocalAccessToken();
      },
      10 * 60 * 1000,
    );
    return () => window.clearInterval(interval);
  }, [refreshLocalAccessToken]);

  return (
    <div className="app-pages-root h-full min-h-0 bg-charcoal-bg text-cream">
      <main className="h-full min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
