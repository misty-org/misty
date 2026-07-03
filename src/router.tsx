import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { AuthProvider } from "./auth/AuthContext";
import { RenderErrorBoundary } from "./shared/components/RenderErrorBoundary";

export const router = createBrowserRouter([
  {
    path: "*",
    element: <RootRoute />,
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}

function RootRoute() {
  return (
    <AuthProvider>
      <RenderErrorBoundary>
        <AppShell />
      </RenderErrorBoundary>
    </AuthProvider>
  );
}
