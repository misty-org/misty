import { RouterProvider } from "react-router";
import { router } from "./routing/routeConfig";
import "@/ui/App.css";

export { router };

export function AppRouter() {
  return <RouterProvider router={router} />;
}
