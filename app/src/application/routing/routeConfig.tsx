import { resolveStartupRoute, routes, useAppRouteMemoryStore } from "@/features/app-shell";
import { AgentsPage } from "@/features/agents";
import { RegisterPage, SignInPage } from "@/features/auth";
import { BrowserWorkspace } from "@/features/browser";
import { DeveloperWorkspace } from "@/features/developer-workspace";
import { MarketplacePage } from "@/features/marketplace";
import FilesPage from "@/features/files/explorer";
import { InboxWorkspace } from "@/features/inbox";
import { SettingsPage } from "@/features/settings";
import { RoadmapDailyMockup, SpaceInvitationRedemption } from "@/features/spaces";
import SpacesShell, { SpaceDetail, SpacesIndexRedirect } from "@/features/spaces";
import { TerminalWorkspace } from "@/features/terminal";
import { TransfersPage } from "@/features/transfers";
import { DesktopAccessState } from "@/shared/ui";
import { createBrowserRouter, Navigate } from "react-router";
import { AppFrameLayout } from "../layouts/AppFrameLayout";
import { AppPagesLayout } from "../layouts/AppPagesLayout";
import { RootLayout } from "../layouts/RootLayout";
import { isDeepLinkRouteAllowed, resolveAuthDeepLinkRoute } from "./navigation";
import { isWebBuild } from "@/shared/platform/buildTarget";

/**
 * Honours the startup preference on the index route.
 *
 * Reads the last remembered route from the store rather than the URL, so
 * "Reopen last session" lands where the user actually left off.
 */
function StartupRedirect() {
  const lastAppRoute = useAppRouteMemoryStore((state) => state.lastAppRoute);
  const fallback = routes.spaces;
  return <Navigate to={resolveStartupRoute(lastAppRoute, fallback)} replace />;
}

const desktopOnlyRoute = (feature: string) =>
  isWebBuild ? <DesktopAccessState feature={feature} /> : null;

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
          { path: "library", element: <Navigate to={routes.files} replace /> },
          { path: "providers", element: null },
          {
            element: <AppPagesLayout />,
            children: [
              { path: "home", element: null },
              { path: "inbox", element: <InboxWorkspace /> },
              { path: "browser", element: desktopOnlyRoute("Browser") ?? <BrowserWorkspace /> },
              { path: "terminal", element: desktopOnlyRoute("Terminal") ?? <TerminalWorkspace /> },
              { path: "files", element: desktopOnlyRoute("Files") ?? <FilesPage /> },
              { path: "agents", element: <AgentsPage /> },
              { path: "code", element: desktopOnlyRoute("Code") ?? <DeveloperWorkspace /> },
              { path: "marketplace", element: <MarketplacePage /> },
              {
                path: "roadmap-preview",
                element: import.meta.env.DEV ? (
                  <RoadmapDailyMockup />
                ) : (
                  <Navigate to={routes.spaces} replace />
                ),
              },
              {
                path: "transfers",
                element: desktopOnlyRoute("Transfers") ?? <TransfersPage />,
              },
              { path: "automations", element: <Navigate to={routes.spaces} replace /> },
              { path: "assistant", element: <Navigate to={routes.agents} replace /> },
              {
                path: "spaces",
                element: <SpacesShell />,
                children: [
                  { index: true, element: <SpacesIndexRedirect /> },
                  { path: "personal", element: <Navigate to={routes.spaces} replace /> },
                  {
                    path: ":spaceId",
                    element: <Navigate to="home" replace />,
                  },
                  { path: ":spaceId/:section/studio/:studioKind", element: <SpaceDetail /> },
                  { path: ":spaceId/:section/:subsection/:plannerView", element: <SpaceDetail /> },
                  { path: ":spaceId/:section/:studioKind", element: <SpaceDetail /> },
                  { path: ":spaceId/:section", element: <SpaceDetail /> },
                ],
              },
              { path: "studio", element: <Navigate to={routes.spaces} replace /> },
              { path: "studio/agents", element: <Navigate to={routes.agents} replace /> },
              { path: "studio/workflows", element: <Navigate to={routes.spaces} replace /> },
              { path: "changelog", element: <Navigate to={routes.spaces} replace /> },
              { path: "signin", element: <SignInPage /> },
              { path: "register", element: <RegisterPage /> },
              { path: "invite/:token", element: <SpaceInvitationRedemption /> },
              // Account management lives on the website now.
              { path: "account", element: <Navigate to={routes.spaces} replace /> },
              { path: "account/signin", element: <Navigate to={routes.signIn} replace /> },
              { path: "account/register", element: <Navigate to={routes.register} replace /> },
              {
                path: "account/settings",
                element: desktopOnlyRoute("Settings") ?? <SettingsPage />,
              },
            ],
          },
          { path: "settings", element: null },
          { path: "diagnostics", element: <Navigate to={routes.spaces} replace /> },
          { path: "*", element: <Navigate to={routes.spaces} replace /> },
        ],
      },
    ],
  },
]);
