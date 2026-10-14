import "@/styles/App.css";
import { RouterProvider } from "react-router";
import { router } from "./routing/RouteConfig";

export function AppRouter() {
  return <RouterProvider router={router} />;
}
