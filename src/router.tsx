import { lazy, Suspense, useEffect } from "react";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import { Boxes, FolderOpen, Home, PencilSparkles, Puzzle } from "lucide-react";
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
import { RootLayout } from "./layouts/RootLayout";
import { isAndroidBuild } from "./platform/buildTarget";
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

const appPageTitles = new Map<string, string>([
  [routes.home, "Misty - Home"],
  [routes.extensions, "Misty - Extensions"],
  [routes.spaces, "Misty - Spaces"],
  [routes.studio, "Misty - Studio"],
  [routes.changelog, "Misty - Changelog"],
  [routes.signIn, "Misty - Sign In"],
  [routes.register, "Misty - Register"],
  [routes.account, "Misty - Account"],
  [routes.transfers, "Misty - Transfers"],
]);

const DesktopLayoutComponent = lazy(() =>
  import("./layouts/DesktopLayout").then((module) => ({ default: module.DesktopLayout })),
);

const desktopNavItems = [
  {
    id: "home",
    label: "Home",
    path: routes.home,
    icon: Home,
    active: (pathname: string) =>
      pathname === routes.home || pathname.startsWith(routes.changelog),
  },
  { id: "files", label: "Files", path: routes.files, icon: FolderOpen },
  {
    id: "spaces",
    label: "Spaces",
    path: routes.spacePersonal,
    icon: Boxes,
    active: (pathname: string) => pathname.startsWith(routes.spaces),
  },
  {
    id: "studio",
    label: "Studio",
    path: routes.studioAgents,
    icon: PencilSparkles,
    active: (pathname: string) => pathname.startsWith(routes.studio),
  },
  ...(isAndroidBuild
    ? []
    : [
        {
          id: "extensions",
          label: "Extensions",
          path: routes.extensions,
          icon: Puzzle,
          active: (pathname: string) => pathname.startsWith(routes.extensions),
        },
      ]),
] satisfies DesktopNavItem[];

const deepLinkPrefixes = [
  routes.transfers,
  routes.files,
  routes.providers,
  routes.automations,
  routes.agents,
  routes.spaces,
  routes.studio,
  routes.account,
  routes.settings,
  routes.home,
  routes.library,
  routes.extensions,
  routes.changelog,
  routes.signIn,
  routes.register,
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
          { path: "transfers", element: <TransfersPage /> },
          { path: "dock", element: <Navigate to={routes.files} replace /> },
          {
            element: <AppPagesLayout />,
            children: [
              { path: "agents", element: <Navigate to={routes.studioAgents} replace /> },
              { path: "automations", element: <Navigate to={routes.studioWorkflows} replace /> },
              {
                path: "spaces",
                element: <SpacesShell />,
                children: [
                  { index: true, element: <Navigate to={routes.spacePersonal} replace /> },
                  { path: "personal", element: <PersonalSpaceRedirect /> },
                  { path: ":spaceId", element: <Navigate to="chat" replace /> },
                  { path: ":spaceId/:section", element: <SpaceDetail /> },
                ],
              },
              { path: "studio/agents", element: <StudioPage kind="agents" /> },
              { path: "studio/workflows", element: <StudioPage kind="workflows" /> },
              { path: "home", element: <HomePage /> },
              {
                path: "extensions",
                element: isAndroidBuild ? <Navigate to={routes.files} replace /> : <ExtensionsPage />,
              },
              {
                path: "changelog",
                element: isAndroidBuild ? <Navigate to={routes.files} replace /> : <ChangelogPage />,
              },
              { path: "signin", element: <SignInPage /> },
              { path: "register", element: <RegisterPage /> },
              { path: "account", element: <AccountPage /> },
              { path: "account/signin", element: <Navigate to={routes.signIn} replace /> },
              { path: "account/register", element: <Navigate to={routes.register} replace /> },
              { path: "account/settings", element: <SettingsPage /> },
            ],
          },
          { path: "settings", element: null },
          { path: "diagnostics", element: <Navigate to={routes.files} replace /> },
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
  return (
    <Suspense fallback={null}>
      <DesktopLayoutComponent getRouteId={desktopRouteIdFromPath} navItems={desktopNavItems} />
    </Suspense>
  );
}

function AppPagesLayout() {
  const location = useLocation();
  const refreshLocalAccessToken = useSetupStore(
    (state) => state.refreshLocalAccessToken,
  );

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

  return (
    <div className="app-pages-root h-full min-h-0 bg-[var(--misty-app-page-bg,#07090b)] text-text">
      <main className="h-full min-h-0">
        <Outlet />
      </main>
    </div>
  );
}

function StartupRedirect() {
  const loaded = useSettingsStore((state) => state.loaded);
  const lastAppRoute = useAppRouteMemoryStore((state) => state.lastAppRoute);

  if (!loaded) {
    return (
      <section
        className="m-[var(--misty-route-margin)] min-h-[calc(100vh-(var(--misty-route-margin)*2))]"
        aria-label="Loading Misty"
      >
        <div className="m-[18px] text-[var(--misty-text-muted)]">Loading...</div>
      </section>
    );
  }

  const target = isRememberableAppRoute(lastAppRoute)
    ? lastAppRoute
    : routes.home;

  return <Navigate to={target} replace />;
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

function isDeepLinkRouteAllowed(route: string): boolean {
  return deepLinkPrefixes.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  );
}

function resolveAuthDeepLinkRoute(target: "account" | "providers"): string {
  return target === "providers" ? routes.providers : routes.account;
}
