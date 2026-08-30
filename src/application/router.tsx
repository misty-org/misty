import "@/styles/App.css";
import { RouterProvider } from "react-router";
import { router } from "./routing/routeConfig";

export { router };

export function AppRouter() {
  return <RouterProvider router={router} />;
}
