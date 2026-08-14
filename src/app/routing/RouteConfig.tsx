import { ActivityPage } from "@/features/activity";
import { resolveStartupRoute, routes, useAppRouteMemoryStore } from "@/features/app-shell";
import { RegisterPage, SignInPage, useAuth } from "@/features/auth";
import { SpaceInvitationRedemption } from "@/features/spaces";
import { createBrowserRouter, Navigate } from "react-router";
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
                path: "activity",
                element: <ActivityPage />,
              },
              {
                path: "scheduled",
                element: null,
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
                path: "spaces/*",
                element: null,
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
                path: "invite/:token",
                element: <SpaceInvitationRedemption />,
              },
              ...(import.meta.env.DEV
                ? [
                    {
                      path: "dev/ui",
                      lazy: async () => ({ Component: (await import("../dev/UiGallery")).default }),
                    },
                  ]
                : []),
            ],
          },
          {
            path: "settings",
            element: null,
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
