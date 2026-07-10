import { lazy, Suspense, useEffect } from "react";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import { ArrowUpDown, Folder, Home, PlugZap, Puzzle, Settings, UserCircle } from "lucide-react";
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
import type { DesktopNavItem } from "./layouts/DesktopLayout";
import {
  MobileLayout,
  type MobileNavItem,
} from "./layouts/MobileLayout";
import { RootLayout, useRootLayoutContext } from "./layouts/RootLayout";
import { detectAppFormFactor, type AppFormFactor } from "./platform/formFactor";
import { isAndroidBuild, isNativeMobileBuild } from "./platform/buildTarget";
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

const isPhoneBuild = import.meta.env.MODE === "mobile";

const appPageTitles = new Map<string, string>([
  ...(isPhoneBuild ? [] : [
    [routes.home, "Misty - Home"],
    [routes.extensions, "Misty - Extensions"],
    [routes.changelog, "Misty - Changelog"],
    [routes.signIn, "Misty - Sign In"],
    [routes.register, "Misty - Register"],
  ] as Array<[string, string]>),
  [routes.account, "Misty - Account"],
  [routes.transfers, "Misty - Transfers"],
]);

const mobileLastRouteStorageKey = "misty.mobile.lastRoute";
const DesktopLayoutComponent = import.meta.env.MODE === "mobile"
  ? null
  : lazy(() => import("./layouts/DesktopLayout").then((module) => ({ default: module.DesktopLayout })));

const desktopNavItems = (isPhoneBuild ? [] : [
  ...(isAndroidBuild ? [] : [
  {
    id: "home",
    label: "Home",
    path: routes.home,
    icon: Home,
    active: (pathname: string) =>
      pathname === routes.home || pathname.startsWith(routes.changelog),
  },
  ]),
  { id: "files", label: "Files", path: routes.files, icon: Folder },
  ...(isAndroidBuild ? [
    { id: "providers", label: "Remotes", path: routes.providers, icon: PlugZap },
    { id: "transfers", label: "Transfers", path: routes.transfers, icon: ArrowUpDown },
    { id: "account", label: "Account", path: routes.account, icon: UserCircle },
    { id: "settings", label: "Settings", path: routes.accountSettings, icon: Settings },
  ] : [
  {
    id: "extensions",
    label: "Extensions",
    path: routes.extensions,
    icon: Puzzle,
    active: (pathname: string) => pathname.startsWith(routes.extensions),
  },
  ]),
]) satisfies DesktopNavItem[];

const mobileNavItems = [
  { id: "files", label: "Files", path: routes.files, icon: Folder, nav: true },
  { id: "providers", label: "Remotes", path: routes.providers, icon: PlugZap, nav: true },
  { id: "transfers", label: "Transfers", path: routes.transfers, icon: ArrowUpDown, nav: true },
  { id: "account", label: "Account", path: routes.account, icon: UserCircle, nav: true },
  { id: "settings", label: "Settings", path: routes.accountSettings, icon: Settings, nav: false },
] satisfies MobileNavItem[];

const mobileAllowedRoutes = new Set<string>(mobileNavItems.map((route) => route.path));
const mobileDeepLinkPrefixes = [
  routes.files,
  routes.providers,
  routes.transfers,
  routes.account,
  routes.settings,
];
const desktopDeepLinkPrefixes = isPhoneBuild ? [] : [
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
            element: <TransfersPage />,
          },
          { path: "dock", element: <Navigate to={routes.files} replace /> },
          {
            element: <AppPagesLayout />,
            children: [
              {
                path: "home",
                element: (
                  <ResponsiveRoute
                    desktop={isAndroidBuild ? <Navigate to={routes.files} replace /> : <HomePage />}
                    mobile={<Navigate to={routes.files} replace />}
                  />
                ),
              },
              {
                path: "extensions",
                element: (
                  <ResponsiveRoute
                    desktop={isAndroidBuild ? <Navigate to={routes.files} replace /> : <ExtensionsPage />}
                    mobile={<Navigate to={routes.files} replace />}
                  />
                ),
              },
              {
                path: "changelog",
                element: (
                  <ResponsiveRoute
                    desktop={isAndroidBuild ? <Navigate to={routes.files} replace /> : <ChangelogPage />}
                    mobile={<Navigate to={routes.files} replace />}
                  />
                ),
              },
              {
                path: "signin",
                element: (
                  <ResponsiveRoute
                    desktop={isAndroidBuild ? <Navigate to={routes.accountSignIn} replace /> : <SignInPage />}
                    mobile={<Navigate to={routes.accountSignIn} replace />}
                  />
                ),
              },
              {
                path: "register",
                element: (
                  <ResponsiveRoute
                    desktop={isAndroidBuild ? <Navigate to={routes.accountRegister} replace /> : <RegisterPage />}
                    mobile={<Navigate to={routes.accountRegister} replace />}
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
                mobile={<Navigate to={routes.accountSettings} replace />}
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
  ) : DesktopLayoutComponent ? (
    <Suspense fallback={null}>
      <DesktopLayoutComponent getRouteId={desktopRouteIdFromPath} navItems={desktopNavItems} />
    </Suspense>
  ) : null;
}

function AppPagesLayout() {
  const location = useLocation();
  const refreshLocalAccessToken = useSetupStore(
    (state) => state.refreshLocalAccessToken,
  );
  const { formFactor } = useRootLayoutContext();

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
  const { formFactor } = useRootLayoutContext();
  return formFactor === "mobile" ? (
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

  const target = isRememberableAppRoute(lastAppRoute)
    ? lastAppRoute
    : isAndroidBuild
      ? routes.files
      : routes.home;

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
  const { formFactor } = useRootLayoutContext();
  return formFactor === "mobile" ? props.mobile : props.desktop;
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
  if (pathname.startsWith(routes.transfers)) return "transfers";
  if (pathname.startsWith(routes.providers)) return "providers";
  if (pathname.startsWith(routes.account)) return "account";
  if (pathname.startsWith(routes.settings)) return "account";
  return "files";
}

function normalizeMobileRoute(pathname: string): string {
  if (pathname.startsWith(routes.transfers)) return routes.transfers;
  if (pathname.startsWith(routes.providers)) return routes.providers;
  if (pathname.startsWith(routes.home)) return routes.files;
  if (pathname.startsWith(routes.accountSettings)) return routes.accountSettings;
  if (pathname.startsWith(routes.account)) return routes.account;
  if (pathname.startsWith(routes.settings)) return routes.accountSettings;
  if (pathname.startsWith(routes.files)) return routes.files;
  if (pathname.startsWith(routes.diagnostics)) return routes.accountSettings;
  return pathname;
}

function safeMobileRoute(pathname: string): string {
  return mobileAllowedRoutes.has(pathname) ? pathname : routes.files;
}

function mobileTitleForPath(pathname: string): string {
  if (pathname.startsWith(routes.transfers)) return "Transfers";
  if (pathname.startsWith(routes.providers)) return "Remotes";
  if (
    pathname.startsWith(routes.accountSettings) ||
    pathname.startsWith(routes.settings)
  ) return "Settings";
  if (pathname.startsWith(routes.account)) return "Account";
  return "Files";
}

function isDeepLinkRouteAllowed(route: string, formFactor: AppFormFactor): boolean {
  const allowedPrefixes = formFactor === "mobile" || isNativeMobileBuild
    ? mobileDeepLinkPrefixes
    : desktopDeepLinkPrefixes;
  return allowedPrefixes.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  );
}

function resolveAuthDeepLinkRoute(target: "account" | "providers"): string {
  return target === "providers" ? routes.providers : routes.account;
}
