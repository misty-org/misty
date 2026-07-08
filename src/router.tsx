import { useEffect } from "react";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import { Folder, Home, PlugZap, Puzzle, Settings, UserCircle } from "lucide-react";
import AccountPage from "./pages/Account";
import ChangelogPage from "./pages/Changelog";
import ExtensionsPage from "./pages/Extensions";
import FilesPage from "./pages/Files";
import HomePage from "./pages/Home";
import ProvidersPage from "./pages/Providers";
import RegisterPage from "./pages/Register";
import SettingsPage from "./pages/Settings";
import SignInPage from "./pages/SignIn";
import TransfersPage from "./pages/Transfers";
import { MobileDesktopRequiredPage } from "./pages/shared/MobileDesktopRequiredPage";
import {
  DesktopLayout,
  type DesktopNavItem,
} from "./layouts/DesktopLayout";
import {
  MobileLayout,
  type MobileNavItem,
} from "./layouts/MobileLayout";
import { RootLayout, useRootLayoutContext } from "./layouts/RootLayout";
import { detectAppFormFactor, type AppFormFactor } from "./platform/formFactor";
import type { AppTab } from "./routing/types";
import {
  isRememberableAppRoute,
  useAppRouteMemoryStore,
} from "./stores/useAppRouteMemoryStore";
import { useSetupStore } from "./stores/useSetupStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import "./App.css";

const routes = {
  root: "/",
  account: "/account",
  accountRegister: "/account/register",
  accountSettings: "/account/settings",
  accountSignIn: "/account/signin",
  activity: "/activity",
  changelog: "/changelog",
  diagnostics: "/diagnostics",
  dock: "/dock",
  extensions: "/extensions",
  files: "/files",
  home: "/home",
  providers: "/providers",
  register: "/register",
  settings: "/settings",
  signIn: "/signin",
  transfers: "/transfers",
} as const;

const appPageTitles = new Map<string, string>([
  [routes.home, "Misty - Home"],
  [routes.extensions, "Misty - Extensions"],
  [routes.changelog, "Misty - Changelog"],
  [routes.signIn, "Misty - Sign In"],
  [routes.register, "Misty - Register"],
  [routes.account, "Misty - Account"],
]);

const mobileLastRouteStorageKey = "misty.mobile.lastRoute";

const desktopNavItems = [
  {
    id: "home",
    label: "Home",
    path: routes.home,
    icon: Home,
    active: (pathname) =>
      pathname === routes.home || pathname.startsWith(routes.changelog),
  },
  { id: "files", label: "Files", path: routes.files, icon: Folder },
  {
    id: "extensions",
    label: "Extensions",
    path: routes.extensions,
    icon: Puzzle,
    active: (pathname) => pathname.startsWith(routes.extensions),
  },
] satisfies DesktopNavItem[];

const mobileNavItems = [
  { id: "files", label: "Files", path: routes.files, icon: Folder, nav: true },
  { id: "providers", label: "Remotes", path: routes.providers, icon: PlugZap, nav: true },
  { id: "account", label: "Account", path: routes.account, icon: UserCircle, nav: true },
  { id: "settings", label: "Settings", path: routes.accountSettings, icon: Settings, nav: false },
  { id: "diagnostics", label: "Diagnostics", path: routes.diagnostics, icon: Settings, nav: false },
] satisfies MobileNavItem[];

const mobileAllowedRoutes = new Set<string>(mobileNavItems.map((route) => route.path));
const mobileDeepLinkPrefixes = [
  routes.files,
  routes.providers,
  routes.account,
  routes.diagnostics,
];
const desktopDeepLinkPrefixes = [
  routes.transfers,
  ...mobileDeepLinkPrefixes,
  routes.home,
  routes.extensions,
  routes.changelog,
  routes.signIn,
  routes.register,
  routes.settings,
];

export const router = createBrowserRouter([
  {
    path: routes.root,
    element: (
      <RootLayout
        isDeepLinkRouteAllowed={isDeepLinkRouteAllowed}
        resolveAuthDeepLinkRoute={resolveAuthDeepLinkRoute}
      />
    ),
    children: [
      {
        element: <AppFrameLayout />,
        children: [
          { index: true, element: <StartupRedirect /> },
          { path: "files", element: <FilesPage /> },
          { path: "providers", element: <ProvidersPage /> },
          {
            path: "transfers",
            element: (
              <ResponsiveRoute
                desktop={<TransfersPage />}
                mobile={<Navigate to={routes.files} replace />}
              />
            ),
          },
          { path: "dock", element: <Navigate to={routes.files} replace /> },
          {
            element: <AppPagesLayout />,
            children: [
              {
                path: "home",
                element: (
                  <ResponsiveRoute
                    desktop={<HomePage />}
                    mobile={<Navigate to={routes.files} replace />}
                  />
                ),
              },
              {
                path: "extensions",
                element: (
                  <ResponsiveRoute
                    desktop={<ExtensionsPage />}
                    mobile={<Navigate to={routes.files} replace />}
                  />
                ),
              },
              {
                path: "changelog",
                element: (
                  <ResponsiveRoute
                    desktop={<ChangelogPage />}
                    mobile={<Navigate to={routes.files} replace />}
                  />
                ),
              },
              {
                path: "signin",
                element: (
                  <ResponsiveRoute
                    desktop={<SignInPage />}
                    mobile={<Navigate to={routes.files} replace />}
                  />
                ),
              },
              {
                path: "register",
                element: (
                  <ResponsiveRoute
                    desktop={<RegisterPage />}
                    mobile={<Navigate to={routes.files} replace />}
                  />
                ),
              },
              { path: "account", element: <AccountPage /> },
              { path: "account/signin", element: <AccountPage /> },
              { path: "account/register", element: <AccountPage /> },
              { path: "account/settings", element: <SettingsPage /> },
            ],
          },
          {
            path: "settings",
            element: (
              <ResponsiveRoute
                desktop={null}
                mobile={<Navigate to={routes.accountSettings} replace />}
              />
            ),
          },
          {
            path: "diagnostics",
            element: (
              <ResponsiveRoute
                desktop={<Navigate to={routes.files} replace />}
                mobile={<MobileDesktopRequiredPage feature="Diagnostics" />}
              />
            ),
          },
          { path: "activity", element: <Navigate to={routes.files} replace /> },
          { path: "*", element: <Navigate to={routes.files} replace /> },
        ],
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}

function AppFrameLayout() {
  const { formFactor } = useRootLayoutContext();
  return formFactor === "mobile" ? (
    <MobileLayout
      getRouteId={mobileRouteIdFromPath}
      lastRouteStorageKey={mobileLastRouteStorageKey}
      navItems={mobileNavItems}
      normalizeRoute={normalizeMobileRoute}
      safeRoute={safeMobileRoute}
      titleForPath={mobileTitleForPath}
    />
  ) : (
    <DesktopLayout getRouteId={desktopRouteIdFromPath} navItems={desktopNavItems} />
  );
}

function AppPagesLayout() {
  const location = useLocation();
  const refreshLocalAccessToken = useSetupStore(
    (state) => state.refreshLocalAccessToken,
  );
  const formFactor = detectAppFormFactor();

  useEffect(() => {
    const match = [...appPageTitles.keys()]
      .sort((left, right) => right.length - left.length)
      .find(
        (path) =>
          location.pathname === path || location.pathname.startsWith(`${path}/`),
      );
    document.title = match ? appPageTitles.get(match) ?? "Misty" : "Misty";
    window.getSelection()?.removeAllRanges();
  }, [location.pathname]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshLocalAccessToken();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshLocalAccessToken]);

  if (formFactor === "mobile") return <Outlet />;

  return (
    <div className="app-pages-root h-full min-h-0 bg-[var(--misty-app-page-bg,#07090b)] text-text">
      <main className="h-full min-h-0">
        <Outlet />
      </main>
    </div>
  );
}

function StartupRedirect() {
  return detectAppFormFactor() === "mobile" ? (
    <MobileStartupRedirect />
  ) : (
    <DesktopStartupRedirect />
  );
}

function DesktopStartupRedirect() {
  const loaded = useSettingsStore((state) => state.loaded);
  const lastAppRoute = useAppRouteMemoryStore((state) => state.lastAppRoute);

  if (!loaded) {
    return (
      <section
        className="m-[var(--misty-route-margin)] min-h-[calc(100vh-(var(--misty-route-margin)*2))]"
        aria-label="Loading Misty"
      >
        <div className="m-[18px] text-[var(--misty-text-muted)]">
          Loading...
        </div>
      </section>
    );
  }

  const target = isRememberableAppRoute(lastAppRoute) ? lastAppRoute : routes.home;

  return <Navigate to={target} replace />;
}

function MobileStartupRedirect() {
  let target: string = routes.files;
  try {
    target = safeMobileRoute(
      normalizeMobileRoute(
        window.localStorage.getItem(mobileLastRouteStorageKey) ?? routes.files,
      ),
    );
  } catch {
    target = routes.files;
  }
  return <Navigate to={target} replace />;
}

function ResponsiveRoute(props: {
  desktop: JSX.Element | null;
  mobile: JSX.Element | null;
}) {
  return detectAppFormFactor() === "mobile" ? props.mobile : props.desktop;
}

function desktopRouteIdFromPath(pathname: string): AppTab {
  if (pathname.startsWith(routes.transfers)) return "transfers";
  if (pathname.startsWith(routes.providers)) return "providers";
  if (pathname.startsWith(routes.account)) return "account";
  if (
    pathname.startsWith(routes.home) ||
    pathname.startsWith(routes.extensions) ||
    pathname.startsWith(routes.changelog) ||
    pathname.startsWith(routes.signIn) ||
    pathname.startsWith(routes.register)
  ) return "home";
  if (pathname.startsWith(routes.settings)) return "settings";
  if (pathname.startsWith(routes.diagnostics)) return "diagnostics";
  return "files";
}

function mobileRouteIdFromPath(pathname: string): AppTab {
  if (pathname.startsWith(routes.providers)) return "providers";
  if (pathname.startsWith(routes.account)) return "account";
  if (pathname.startsWith(routes.settings)) return "account";
  if (pathname.startsWith(routes.diagnostics)) return "diagnostics";
  return "files";
}

function normalizeMobileRoute(pathname: string): string {
  if (pathname.startsWith(routes.transfers)) return routes.files;
  if (pathname.startsWith(routes.providers)) return routes.providers;
  if (pathname.startsWith(routes.home)) return routes.files;
  if (pathname.startsWith(routes.accountSettings)) return routes.accountSettings;
  if (pathname.startsWith(routes.account)) return routes.account;
  if (pathname.startsWith(routes.settings)) return routes.accountSettings;
  if (pathname.startsWith(routes.files)) return routes.files;
  return pathname;
}

function safeMobileRoute(pathname: string): string {
  return mobileAllowedRoutes.has(pathname) ? pathname : routes.files;
}

function mobileTitleForPath(pathname: string): string {
  if (pathname.startsWith(routes.providers)) return "Remotes";
  if (
    pathname.startsWith(routes.accountSettings) ||
    pathname.startsWith(routes.settings)
  ) return "Settings";
  if (pathname.startsWith(routes.account)) return "Account";
  if (pathname.startsWith(routes.diagnostics)) return "Diagnostics";
  if (pathname !== routes.root && !pathname.startsWith(routes.files)) {
    return "Desktop only";
  }
  return "Files";
}

function isDeepLinkRouteAllowed(route: string, formFactor: AppFormFactor): boolean {
  const allowedPrefixes =
    formFactor === "mobile" ? mobileDeepLinkPrefixes : desktopDeepLinkPrefixes;
  return allowedPrefixes.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  );
}

function resolveAuthDeepLinkRoute(target: "account" | "providers"): string {
  return target === "providers" ? routes.providers : routes.account;
}
