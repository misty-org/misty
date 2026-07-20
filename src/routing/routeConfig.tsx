import { createBrowserRouter, Navigate } from "react-router";
import { RootLayout } from "../layouts/RootLayout";
import AccountPage from "../pages/Account";
import CloudFolderBotChatOverlay from "../pages/BotOverlay/CloudFolderBotChatOverlay";
import CloudFolderBotOverlay from "../pages/BotOverlay/CloudFolderBotOverlay";
import ExtensionsPage from "../pages/Extensions";
import FilesPage from "../pages/Files";
import ProvidersPage from "../pages/Providers";
import RegisterPage from "../pages/Register";
import SettingsPage from "../pages/Settings";
import SignInPage from "../pages/SignIn";
import SpacesShell, { PersonalSpaceRedirect, SpaceDetail } from "../pages/Spaces";
import TransfersPage from "../pages/Transfers";
import { AppFrameLayout } from "../layouts/AppFrameLayout";
import { AppPagesLayout } from "../layouts/AppPagesLayout";
import { isDeepLinkRouteAllowed, resolveAuthDeepLinkRoute } from "./navigation";
import { routes } from "./paths";

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
          { index: true, element: <Navigate to={routes.files} replace /> },
          { path: "files", element: <FilesPage /> },
          { path: "library", element: <Navigate to={routes.spacePersonal} replace /> },
          { path: "providers", element: <ProvidersPage /> },
          { path: "transfers", element: <TransfersPage /> },
          {
            element: <AppPagesLayout />,
            children: [
              { path: "agents", element: <Navigate to={routes.spacePersonal} replace /> },
              { path: "automations", element: <Navigate to={routes.spacePersonal} replace /> },
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
              { path: "studio", element: <Navigate to={routes.spacePersonal} replace /> },
              { path: "studio/agents", element: <Navigate to={routes.spacePersonal} replace /> },
              { path: "studio/workflows", element: <Navigate to={routes.spacePersonal} replace /> },
              { path: "home", element: <Navigate to={routes.files} replace /> },
              { path: "extensions", element: <ExtensionsPage /> },
              { path: "changelog", element: <Navigate to={routes.files} replace /> },
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
