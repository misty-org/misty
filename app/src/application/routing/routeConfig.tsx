import { resolveStartupRoute, routes, useAppRouteMemoryStore } from "@/features/app-shell";
import { AgentsPage } from "@/features/agents";
import { RegisterPage, SignInPage } from "@/features/auth";
import { BrowserWorkspace } from "@/features/browser";
import { DeveloperWorkspace } from "@/features/developer-workspace";
import { ExtensionsPage } from "@/features/extensions";
import FilesPage from "@/features/files/explorer";
import { HomeDashboard } from "@/features/home";
import { InboxWorkspace } from "@/features/inbox";
import { spaceNotesEnabled } from "@/features/notes";
import { SettingsPage } from "@/features/settings";
import { SpaceInvitationRedemption } from "@/features/spaces";
import SpacesShell, { SpaceDetail, SpacesIndexRedirect } from "@/features/spaces";
import { TerminalWorkspace } from "@/features/terminal";
import { TransfersPage } from "@/features/transfers";
import { createBrowserRouter, Navigate } from "react-router";
import { AppFrameLayout } from "../layouts/AppFrameLayout";
import { AppPagesLayout } from "../layouts/AppPagesLayout";
import { RootLayout } from "../layouts/RootLayout";
import { WebUnavailablePage } from "../layouts/WebUnavailablePage";
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
  const fallback = isWebBuild ? routes.spaces : routes.home;
  return <Navigate to={resolveStartupRoute(lastAppRoute, fallback)} replace />;
}

const desktopOnlyRoute = (feature: string) =>
  isWebBuild ? <WebUnavailablePage feature={feature} /> : null;

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
              { path: "home", element: desktopOnlyRoute("Home dashboard") ?? <HomeDashboard /> },
              { path: "inbox", element: desktopOnlyRoute("Inbox") ?? <InboxWorkspace /> },
              { path: "browser", element: desktopOnlyRoute("Browser") ?? <BrowserWorkspace /> },
              { path: "terminal", element: desktopOnlyRoute("Terminal") ?? <TerminalWorkspace /> },
              { path: "files", element: desktopOnlyRoute("Files") ?? <FilesPage /> },
              { path: "agents", element: desktopOnlyRoute("Agents") ?? <AgentsPage /> },
              { path: "code", element: desktopOnlyRoute("Code") ?? <DeveloperWorkspace /> },
              { path: "extensions", element: desktopOnlyRoute("Extensions") ?? <ExtensionsPage /> },
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
                    element: <Navigate to={spaceNotesEnabled ? "notes" : "drawings"} replace />,
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
                element: desktopOnlyRoute("Account settings") ?? <SettingsPage />,
              },
            ],
          },
          { path: "settings", element: null },
          { path: "diagnostics", element: <Navigate to={routes.spaces} replace /> },
          { path: "*", element: <Navigate to={routes.home} replace /> },
        ],
      },
    ],
  },
]);
