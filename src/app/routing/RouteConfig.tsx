import { resolveStartupRoute, routes, useAppRouteMemoryStore } from "@/app/shell";
import { RegisterPage, SignInPage, useAuth } from "@/features/account";
import { useSetupStore } from "@/features/account";
import { SetupPage, WelcomePage } from "@/features/onboarding";
import { SpaceInvitationRedemption } from "@/features/spaces";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppFrameLayout } from "../layouts/AppFrameLayout";
import { AppPagesLayout } from "../layouts/AppPagesLayout";
import { RootLayout } from "../layouts/RootLayout";
import { isDeepLinkRouteAllowed, resolveAuthDeepLinkRoute } from "./navigation";
function StartupRedirect() {
  const { user } = useAuth();
  const welcomed = useSetupStore((state) => state.welcomed);
  const lastAppRoute = useAppRouteMemoryStore((state) => state.lastAppRoute);
  if (!user) return <Navigate to={welcomed ? routes.signIn : routes.welcome} replace />;
  return <Navigate to={resolveStartupRoute(lastAppRoute)} replace />;
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
            element: <AppPagesLayout />,
            children: [
              {
                path: "new",
                element: null,
              },
              {
                path: "agents",
                element: null,
              },
              {
                path: "spaces/*",
                element: null,
              },
              {
                path: "dms/*",
                element: null,
              },
              {
                path: "friends",
                element: null,
              },
              {
                path: "browser/*",
                element: null,
              },
              {
                path: "welcome",
                element: <WelcomePage />,
              },
              {
                path: "setup",
                element: <SetupPage />,
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
            element: <StartupRedirect />,
          },
        ],
      },
    ],
  },
]);
