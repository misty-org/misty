import { createBrowserRouter, Navigate } from "react-router";
import { RootLayout } from "../layouts/RootLayout";
import RegisterPage from "../pages/Register";
import SettingsPage from "../pages/Settings";
import SignInPage from "../pages/SignIn";
import SpacesShell, { SpacesIndexRedirect, SpaceDetail } from "../pages/Spaces";
import { AppFrameLayout } from "../layouts/AppFrameLayout";
import { AppPagesLayout } from "../layouts/AppPagesLayout";
import { isDeepLinkRouteAllowed, resolveAuthDeepLinkRoute } from "./navigation";
import { routes } from "./paths";
import { LegacyAgentRedirect } from "./LegacyAgentRedirect";
import { LegacyWorkspaceToolRedirect } from "./LegacyWorkspaceToolRedirect";
import { SpaceInvitationRedemption } from "../features/spaces/components/SpaceInvitationRedemption";
import { spaceNotesEnabled } from "../features/notes/availability";
import AgentsPage from "../pages/Agents";
import { agentTeammatesV1Enabled } from "../features/agents/flags";

const legacyAgentElement = agentTeammatesV1Enabled() ? <LegacyAgentRedirect /> : <AgentsPage />;

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
          { index: true, element: <Navigate to={routes.spaces} replace /> },
          { path: "files", element: <LegacyWorkspaceToolRedirect kind="file-manager" /> },
          { path: "library", element: <Navigate to={routes.files} replace /> },
          { path: "providers", element: null },
          { path: "transfers", element: <LegacyWorkspaceToolRedirect kind="transfers" /> },
          {
            element: <AppPagesLayout />,
            children: [
              { path: "agents", element: legacyAgentElement },
              { path: "automations", element: <Navigate to={routes.spaces} replace /> },
              { path: "assistant", element: legacyAgentElement },
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
              { path: "studio/agents", element: legacyAgentElement },
              { path: "studio/workflows", element: <Navigate to={routes.spaces} replace /> },
              { path: "extensions", element: <LegacyWorkspaceToolRedirect kind="extensions" /> },
              { path: "changelog", element: <Navigate to={routes.spaces} replace /> },
              { path: "signin", element: <SignInPage /> },
              { path: "register", element: <RegisterPage /> },
              { path: "invite/:token", element: <SpaceInvitationRedemption /> },
              // Account management lives on the website now.
              { path: "account", element: <Navigate to={routes.spaces} replace /> },
              { path: "account/signin", element: <Navigate to={routes.signIn} replace /> },
              { path: "account/register", element: <Navigate to={routes.register} replace /> },
              { path: "account/settings", element: <SettingsPage /> },
            ],
          },
          { path: "settings", element: null },
          { path: "diagnostics", element: <Navigate to={routes.spaces} replace /> },
          { path: "activity", element: <Navigate to={routes.spaces} replace /> },
          { path: "*", element: <Navigate to={routes.spaces} replace /> },
        ],
      },
    ],
  },
]);
