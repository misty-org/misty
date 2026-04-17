import { createBrowserRouter, Navigate } from "react-router";
import { RootLayout } from "../layouts/RootLayout";
import AccountPage from "../pages/Account";
import FilesPage from "../pages/Files";
import HomePage from "../pages/Home";
import RegisterPage from "../pages/Register";
import SettingsPage from "../pages/Settings";
import SignInPage from "../pages/SignIn";
import SpacesShell, { SpacesIndexRedirect, SpaceDetail } from "../pages/Spaces";
import TransfersPage from "../pages/Transfers";
import { AppFrameLayout } from "../layouts/AppFrameLayout";
import { AppPagesLayout } from "../layouts/AppPagesLayout";
import { isDeepLinkRouteAllowed, resolveAuthDeepLinkRoute } from "./navigation";
import { routes } from "./paths";
import { LegacyAgentRedirect } from "./LegacyAgentRedirect";
import AgentsPage from "../pages/Agents";
import ExtensionsPage from "../pages/Extensions";
import { SpaceInvitationRedemption } from "../features/spaces/components/SpaceInvitationRedemption";

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
          { index: true, element: <Navigate to={routes.home} replace /> },
          { path: "files", element: <FilesPage /> },
          { path: "library", element: <Navigate to={routes.files} replace /> },
          { path: "providers", element: null },
          { path: "transfers", element: <TransfersPage /> },
          {
            element: <AppPagesLayout />,
            children: [
              { path: "agents", element: <AgentsPage /> },
              { path: "automations", element: <Navigate to={routes.spaces} replace /> },
              { path: "assistant", element: <LegacyAgentRedirect /> },
              {
                path: "spaces",
                element: <SpacesShell />,
                children: [
                  { index: true, element: <SpacesIndexRedirect /> },
                  { path: "personal", element: <Navigate to={routes.spaces} replace /> },
                  { path: ":spaceId", element: <Navigate to="chat" replace /> },
                  { path: ":spaceId/:section/studio/:studioKind", element: <SpaceDetail /> },
                  { path: ":spaceId/:section/:studioKind", element: <SpaceDetail /> },
                  { path: ":spaceId/:section", element: <SpaceDetail /> },
                ],
              },
              { path: "studio", element: <Navigate to={routes.spaces} replace /> },
              { path: "studio/agents", element: <Navigate to={routes.agents} replace /> },
              { path: "studio/workflows", element: <Navigate to={routes.spaces} replace /> },
              { path: "home", element: <HomePage /> },
              { path: "extensions", element: <ExtensionsPage /> },
              { path: "changelog", element: <Navigate to={routes.files} replace /> },
              { path: "signin", element: <SignInPage /> },
              { path: "register", element: <RegisterPage /> },
              { path: "invite/:token", element: <SpaceInvitationRedemption /> },
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
