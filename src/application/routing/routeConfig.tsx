import { resolveStartupRoute, routes, useAppRouteMemoryStore } from "@/features/app-shell";
import { ActivityPage } from "@/features/activity";
import { MobileProfilePage, RegisterPage, SignInPage, useAuth } from "@/features/auth";
import { DiscoverPage } from "@/features/marketplace";
import { SettingsPage } from "@/features/settings";
import { SpaceInvitationRedemption } from "@/features/spaces";
import SpacesShell, { SpaceDetail, SpacesIndexRedirect } from "@/features/spaces";
import { createBrowserRouter, Navigate } from "react-router";
import { AppFrameLayout } from "../layouts/AppFrameLayout";
import { AppPagesLayout } from "../layouts/AppPagesLayout";
import { RootLayout } from "../layouts/RootLayout";
import { isDeepLinkRouteAllowed, resolveAuthDeepLinkRoute } from "./navigation";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";

/**
 * Honours the startup preference on the index route.
 *
 * Reads the last remembered route from the store rather than the URL, so
 * "Reopen last session" lands where the user actually left off.
 */
function StartupRedirect() {
  const { user } = useAuth();
  const lastAppRoute = useAppRouteMemoryStore((state) => state.lastAppRoute);
  if (!user) {
    return <Navigate to={routes.signIn} replace />;
  }
  const fallback = routes.spaces;
  return <Navigate to={resolveStartupRoute(lastAppRoute, fallback)} replace />;
}

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
          { path: "providers", element: null },
          {
            element: <AppPagesLayout />,
            children: [
              { path: "home", element: null },
              { path: "apps", element: <Navigate to={routes.discover} replace /> },
              {
                path: "activity",
                element: isNativeMobileBuild ? (
                  <ActivityPage />
                ) : (
                  <Navigate to={routes.spaces} replace />
                ),
              },
              { path: "apps/:appId", element: null },
              { path: "discover", element: <DiscoverPage /> },
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
                  { path: ":spaceId/home", element: <SpaceDetail /> },
                  { path: ":spaceId/settings/:studioKind", element: <SpaceDetail /> },
                ],
              },
              { path: "changelog", element: <Navigate to={routes.spaces} replace /> },
              { path: "signin", element: <SignInPage /> },
              { path: "register", element: <RegisterPage /> },
              {
                path: "profile",
                element: isNativeMobileBuild ? (
                  <MobileProfilePage />
                ) : (
                  <Navigate to={routes.account} replace />
                ),
              },
              { path: "invite/:token", element: <SpaceInvitationRedemption /> },
              // Account management lives on the website now.
              {
                path: "account",
                element: isNativeMobileBuild ? (
                  <Navigate to={routes.profile} replace />
                ) : (
                  <Navigate to={routes.spaces} replace />
                ),
              },
              { path: "account/signin", element: <Navigate to={routes.signIn} replace /> },
              { path: "account/register", element: <Navigate to={routes.register} replace /> },
              {
                path: "account/settings",
                element: isNativeMobileBuild ? (
                  <Navigate to={routes.profile} replace />
                ) : (
                  <SettingsPage />
                ),
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
