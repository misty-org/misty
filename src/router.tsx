import { lazy, Suspense, useEffect } from "react";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import { ArrowUpDown, Boxes, Folder, FolderOpen, Home, PencilSparkles, PlugZap, Puzzle, Settings, UserCircle } from "lucide-react";
import AccountPage from "./pages/Account";
import ChangelogPage from "./pages/Changelog";
import ExtensionsPage from "./pages/Extensions";
import FilesPage from "./pages/Files";
import HomePage from "./pages/Home";
import CloudFolderBotOverlay from "./pages/BotOverlay/CloudFolderBotOverlay";
import CloudFolderBotChatOverlay from "./pages/BotOverlay/CloudFolderBotChatOverlay";
import ProvidersPage from "./pages/Providers";
import RegisterPage from "./pages/Register";
import SettingsPage from "./pages/Settings";
import SignInPage from "./pages/SignIn";
import TransfersPage from "./pages/Transfers";
import SpacesShell, { PersonalSpaceRedirect, SpaceDetail } from "./pages/Spaces";
import StudioPage from "./pages/Studio";
import type { DesktopNavItem } from "./layouts/DesktopLayout";
import {
  MobileLayout,
  type MobileNavItem,
} from "./layouts/MobileLayout";
import { RootLayout } from "./layouts/RootLayout";
import { detectAppFormFactor, type AppFormFactor, useAppFormFactor } from "./platform/formFactor";
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
  agents: "/agents",
  automations: "/automations",
  changelog: "/changelog",
  diagnostics: "/diagnostics",
  dock: "/dock",
  extensions: "/extensions",
  files: "/files",
  home: "/home",
  library: "/library",
  spaces: "/spaces",
  spacePersonal: "/spaces/personal",
  studio: "/studio",
  studioAgents: "/studio/agents",
  studioWorkflows: "/studio/workflows",
  providers: "/providers",
  register: "/register",
  settings: "/settings",
  signIn: "/signin",
  transfers: "/transfers",
  cloudFolderBot: "/bot/cloud-folder",
} as const;

const isPhoneBuild = import.meta.env.MODE === "mobile";

const appPageTitles = new Map<string, string>([
  ...(isPhoneBuild ? [] : [
    [routes.home, "Misty - Home"],
    [routes.extensions, "Misty - Extensions"],
    [routes.spaces, "Misty - Spaces"],
    [routes.studio, "Misty - Studio"],
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
  {
    id: "home",
    label: "Home",
    path: routes.home,
    icon: Home,
    active: (pathname: string) =>
      pathname === routes.home || pathname.startsWith(routes.changelog),
  },
  { id: "files", label: "Files", path: routes.files, icon: FolderOpen },
  { id: "spaces", label: "Spaces", path: routes.spacePersonal, icon: Boxes, active: (pathname: string) => pathname.startsWith(routes.spaces) },
  { id: "studio", label: "Studio", path: routes.studioAgents, icon: PencilSparkles, active: (pathname: string) => pathname.startsWith(routes.studio) },
  ...(isAndroidBuild ? [] : [
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
  routes.automations,
  routes.agents,
  routes.spaces,
  routes.studio,
  routes.account,
  routes.settings,
];
const desktopDeepLinkPrefixes = isPhoneBuild ? [] : [
  routes.transfers,
  ...mobileDeepLinkPrefixes,
  routes.home,
  routes.spaces,
  routes.studio,
  routes.library,
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
      { path: "bot/cloud-folder", element: <CloudFolderBotOverlay /> },
      { path: "bot/cloud-folder-chat", element: <CloudFolderBotChatOverlay /> },
      { path: "pet/cloud-folder", element: <Navigate to={routes.cloudFolderBot} replace /> },
      {
        element: <AppFrameLayout />,
        children: [
          { index: true, element: <StartupRedirect /> },
          { path: "files", element: <FilesPage /> },
          { path: "library", element: <Navigate to={routes.spacePersonal} replace /> },
          { path: "providers", element: <ProvidersPage /> },
          {
            path: "transfers",
            element: <TransfersPage />,
          },
          { path: "dock", element: <Navigate to={routes.files} replace /> },
          {
            element: <AppPagesLayout />,
            children: [
              { path: "agents", element: <Navigate to={routes.studioAgents} replace /> },
              { path: "automations", element: <Navigate to={routes.studioWorkflows} replace /> },
              {
                path: "spaces",
                element: <ResponsiveRoute desktop={isAndroidBuild ? <Navigate to={routes.files} replace /> : <SpacesShell />} mobile={<Navigate to={routes.files} replace />} />,
                children: [
                  { index: true, element: <Navigate to={routes.spacePersonal} replace /> },
                  { path: "personal", element: <PersonalSpaceRedirect /> },
                  { path: ":spaceId", element: <Navigate to="chat" replace /> },
                  { path: ":spaceId/:section", element: <SpaceDetail /> },
                ],
              },
              {
                path: "studio/agents",
                element: <ResponsiveRoute desktop={isAndroidBuild ? <Navigate to={routes.files} replace /> : <StudioPage kind="agents" />} mobile={<Navigate to={routes.files} replace />} />,
              },
              {
                path: "studio/workflows",
                element: <ResponsiveRoute desktop={isAndroidBuild ? <Navigate to={routes.files} replace /> : <StudioPage kind="workflows" />} mobile={<Navigate to={routes.files} replace />} />,
              },
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
                    desktop={<SignInPage />}
                    mobile={<Navigate to={routes.accountSignIn} replace />}
                  />
                ),
              },
              {
                path: "register",
                element: (
                  <ResponsiveRoute
                    desktop={<RegisterPage />}
                    mobile={<Navigate to={routes.accountRegister} replace />}
                  />
                ),
              },
              {
                path: "account",
                element: (
                  <ResponsiveRoute
                    desktop={null}
                    mobile={<AccountPage />}
                  />
                ),
              },
              {
                path: "account/signin",
                element: (
                  <ResponsiveRoute
                    desktop={<Navigate to={routes.signIn} replace />}
                    mobile={<AccountPage />}
                  />
                ),
              },
              {
                path: "account/register",
                element: (
                  <ResponsiveRoute
                    desktop={<Navigate to={routes.register} replace />}
                    mobile={<AccountPage />}
                  />
                ),
              },
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
  const formFactor = useAppFormFactor();
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
  const formFactor = useAppFormFactor();

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
  const formFactor = useAppFormFactor();
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
  const formFactor = useAppFormFactor();
  return formFactor === "mobile" ? props.mobile : props.desktop;
}

function desktopRouteIdFromPath(pathname: string): AppTab {
  if (pathname.startsWith(routes.spaces) || pathname.startsWith(routes.library)) return "spaces";
  if (pathname.startsWith(routes.studio) || pathname.startsWith(routes.agents) || pathname.startsWith(routes.automations)) return "studio";
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
