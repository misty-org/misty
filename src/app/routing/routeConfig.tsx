import { ActivityPage } from "@/features/activity";
import { resolveStartupRoute, routes, useAppRouteMemoryStore } from "@/features/app-shell";
import { RegisterPage, SignInPage, useAuth } from "@/features/auth";
import { SettingsPage } from "@/features/settings";
import { SpaceInvitationRedemption } from "@/features/spaces/components/SpaceInvitationRedemption";
import { createBrowserRouter, Navigate, useLocation } from "react-router";
import { AppFrameLayout } from "../layouts/AppFrameLayout";
import { AppPagesLayout } from "../layouts/AppPagesLayout";
import { RootLayout } from "../layouts/RootLayout";
import { isDeepLinkRouteAllowed, resolveAuthDeepLinkRoute } from "./navigation";
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
  const fallback = routes.home;
  return <Navigate to={resolveStartupRoute(lastAppRoute, fallback)} replace />;
}
function LegacyToolRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
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
          {
            index: true,
            element: <StartupRedirect />,
          },
          {
            path: "providers",
            element: null,
          },
          {
            element: <AppPagesLayout />,
            children: [
              {
                path: "home",
                element: null,
              },
              {
                path: "new",
                element: null,
              },
              {
                path: "apps",
                element: <Navigate to={routes.home} replace />,
              },
              {
                path: "activity",
                element: <ActivityPage />,
              },
              {
                path: "browser",
                element: null,
              },
              {
                path: "agents",
                element: null,
              },
              {
                path: "files",
                element: null,
              },
              {
                path: "apps/files",
                element: <LegacyToolRedirect to="/files" />,
              },
              {
                path: "apps/agents",
                element: <LegacyToolRedirect to="/agents" />,
              },
              {
                path: "apps/*",
                element: <Navigate to="/browser" replace />,
              },
              {
                path: "discover",
                element: <Navigate to="/browser" replace />,
              },
              {
                path: "spaces/*",
                element: null,
              },
              {
                path: "changelog",
                element: <Navigate to={routes.home} replace />,
              },
              {
                path: "signin",
                element: <SignInPage />,
              },
              {
                path: "register",
                element: <RegisterPage />,
              },
              {
                path: "profile",
                element: <Navigate to={routes.account} replace />,
              },
              {
                path: "invite/:token",
                element: <SpaceInvitationRedemption />,
              },
              // Account management lives on the website now.
              {
                path: "account",
                element: <Navigate to={routes.home} replace />,
              },
              {
                path: "account/signin",
                element: <Navigate to={routes.signIn} replace />,
              },
              {
                path: "account/register",
                element: <Navigate to={routes.register} replace />,
              },
              {
                path: "account/settings",
                element: <SettingsPage />,
              },
            ],
          },
          {
            path: "settings",
            element: null,
          },
          {
            path: "diagnostics",
            element: <Navigate to={routes.home} replace />,
          },
          {
            path: "*",
            element: <Navigate to={routes.home} replace />,
          },
        ],
      },
    ],
  },
]);
