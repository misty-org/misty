import { useEffect } from "react";
import type { ReactNode } from "react";
import {
  Navigate,
  Outlet,
  useLocation,
  type RouteObject,
} from "react-router-dom";
import AccountPage from "./Account";
import ChangelogPage from "./Changelog";
import ExtensionsPage from "./Extensions";
import HomePage from "./Home";
import RegisterPage from "./Register";
import SignInPage from "./SignIn";
import { useSetupStore } from "../stores/useSetupStore";
import "../App.css";

const titleByPath = new Map([
  ["/home", "Misty - Home"],
  ["/extensions", "Misty - Extensions"],
  ["/plugins", "Misty - Extensions"],
  ["/changelog", "Misty - Changelog"],
  ["/signin", "Misty - Sign In"],
  ["/register", "Misty - Register"],
  ["/account", "Misty - Account"],
]);

export const mainAppRoutes: RouteObject[] = [
  {
    element: <MainAppPagesShell />,
    children: [
      { path: "/home", element: <HomePage /> },
      { path: "/extensions", element: <ExtensionsPage /> },
      { path: "/plugins", element: <Navigate to="/extensions" replace /> },
      { path: "/changelog", element: <ChangelogPage /> },
      { path: "/signin", element: <SignInPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/account", element: <AccountPage /> },
    ],
  },
];

function MainAppPagesShell() {
  const loadSystem = useSetupStore((state) => state.loadSystem);
  const refreshLocalAccessToken = useSetupStore(
    (state) => state.refreshLocalAccessToken,
  );

  useEffect(() => {
    void loadSystem();
  }, [loadSystem]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshLocalAccessToken();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshLocalAccessToken]);

  return (
    <MainAppPageShell>
      <Outlet />
    </MainAppPageShell>
  );
}

function MainAppPageShell({ children }: { children: ReactNode }) {
  const location = useLocation();

  useEffect(() => {
    const match = [...titleByPath.keys()]
      .sort((left, right) => right.length - left.length)
      .find(
        (path) =>
          location.pathname === path || location.pathname.startsWith(`${path}/`),
      );
    const title = match ? titleByPath.get(match) : "Misty";

    if (title) {
      document.title = title;
    }
    window.getSelection()?.removeAllRanges();
  }, [location.pathname]);

  return (
    <div className="app-pages-root h-full min-h-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05),transparent_22%),linear-gradient(180deg,#07090b,#090c10_58%,#07090b)] text-text">
      <main className="h-full min-h-0">{children}</main>
    </div>
  );
}
