import { lazy, Suspense, useEffect } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router";
import { FolderOpen, PanelsTopLeft, Puzzle } from "lucide-react";
import AccountPage from "./pages/Account";
import ChangelogPage from "./pages/Changelog";
import ExtensionsPage from "./pages/Extensions";
import FilesPage from "./pages/Files";
import CloudFolderBotOverlay from "./pages/BotOverlay/CloudFolderBotOverlay";
import CloudFolderBotChatOverlay from "./pages/BotOverlay/CloudFolderBotChatOverlay";
import ProvidersPage from "./pages/Providers";
import RegisterPage from "./pages/Register";
import SettingsPage from "./pages/Settings";
import SignInPage from "./pages/SignIn";
import TransfersPage from "./pages/Transfers";
import SpacesShell, { PersonalSpaceRedirect, SpaceDetail } from "./pages/Spaces";
import type { DesktopNavItem } from "./layouts/DesktopLayout";
import { RootLayout } from "./layouts/RootLayout";
import { isAndroidBuild } from "./platform/buildTarget";
import type { AppTab } from "./routing/types";
import { isRememberableAppRoute, useAppRouteMemoryStore } from "./stores/useAppRouteMemoryStore";
import { useSetupStore } from "./stores/useSetupStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useSpacesStore } from "./stores/useSpacesStore";
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
  [routes.extensions, "Misty - Extensions"],
  [routes.spaces, "Misty - Spaces"],
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
  { id: "files", label: "Files", path: routes.files, icon: FolderOpen },
  {
    id: "spaces",
    label: "Spaces",
    path: routes.spacePersonal,
    icon: PanelsTopLeft,
    active: (pathname: string) => pathname.startsWith(routes.spaces),
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
          {
            element: <AppPagesLayout />,
            children: [
              { path: "agents", element: <LegacyStudioRedirect kind="agents" /> },
              { path: "automations", element: <LegacyStudioRedirect kind="folder-agents" /> },
              {
                path: "spaces",
                element: <SpacesShell />,
                children: [
                  { index: true, element: <Navigate to={routes.spacePersonal} replace /> },
                  { path: "personal", element: <PersonalSpaceRedirect /> },
                  { path: ":spaceId", element: <Navigate to="chat" replace /> },
                  { path: ":spaceId/tasks", element: <Navigate to="board" replace /> },
                  { path: ":spaceId/:section/studio/:studioKind", element: <SpaceDetail /> },
                  { path: ":spaceId/:section/:studioKind", element: <SpaceDetail /> },
                  { path: ":spaceId/:section", element: <SpaceDetail /> },
                ],
              },
              { path: "studio", element: <LegacyStudioRedirect kind="agents" /> },
              { path: "studio/agents", element: <LegacyStudioRedirect kind="agents" /> },
              { path: "studio/workflows", element: <LegacyStudioRedirect kind="workflows" /> },
              { path: "home", element: <Navigate to={routes.files} replace /> },
              {
                path: "extensions",
                element: isAndroidBuild ? (
                  <Navigate to={routes.files} replace />
                ) : (
                  <ExtensionsPage />
                ),
              },
              {
                path: "changelog",
                element: isAndroidBuild ? (
                  <Navigate to={routes.files} replace />
                ) : (
                  <ChangelogPage />
                ),
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
  const lastSpacesRoute = useAppRouteMemoryStore((state) => state.lastSpacesRoute);

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

  const rememberedRoute = lastAppRoute.startsWith(routes.spaces) ? lastSpacesRoute : lastAppRoute;
  const target = isRememberableAppRoute(rememberedRoute) ? rememberedRoute : routes.files;

  return <Navigate to={target} replace />;
}

function LegacyStudioRedirect({ kind }: { kind: "agents" | "folder-agents" | "workflows" }) {
  const location = useLocation();
  const spaces = useSpacesStore((state) => state.spaces);
  const loading = useSpacesStore((state) => state.loading);
  const load = useSpacesStore((state) => state.load);

  useEffect(() => {
    if (spaces.length === 0 && !loading) void load();
  }, [load, loading, spaces.length]);
  if (spaces.length === 0)
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--misty-text-muted)]">
        Loading your Space Studio…
      </div>
    );

  const params = new URLSearchParams(location.search);
  const requestedSpaceId = params.get("spaceId") ?? params.get("space") ?? "";
  const space =
    spaces.find((candidate) => candidate.id === requestedSpaceId) ??
    spaces.find((candidate) => candidate.is_personal) ??
    spaces[0];
  const targetKind = kind === "folder-agents" ? "agents" : kind;
  params.delete("scope");
  params.delete("space");
  params.delete("spaceId");
  const query = params.toString();
  return (
    <Navigate
      to={`/spaces/${encodeURIComponent(space.id)}/agents/studio/${targetKind}${query ? `?${query}` : ""}`}
      replace
    />
  );
}

function desktopRouteIdFromPath(pathname: string): AppTab {
  if (pathname.startsWith(routes.spaces) || pathname.startsWith(routes.library)) return "spaces";
  if (
    pathname.startsWith(routes.studio) ||
    pathname.startsWith(routes.agents) ||
    pathname.startsWith(routes.automations)
  )
    return "agents";
  if (pathname.startsWith(routes.transfers)) return "transfers";
  if (pathname.startsWith(routes.providers)) return "providers";
  if (pathname.startsWith(routes.account)) return "account";
  if (
    pathname.startsWith(routes.extensions) ||
    pathname.startsWith(routes.changelog) ||
    pathname.startsWith(routes.signIn) ||
    pathname.startsWith(routes.register)
  )
    return "home";
  if (pathname.startsWith(routes.settings)) return "settings";
  if (pathname.startsWith(routes.diagnostics)) return "diagnostics";
  return "files";
}

function isDeepLinkRouteAllowed(route: string): boolean {
  return deepLinkPrefixes.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

function resolveAuthDeepLinkRoute(target: "account" | "providers"): string {
  return target === "providers" ? routes.providers : routes.account;
}
