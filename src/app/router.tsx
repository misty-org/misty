import "@/styles/App.css";
import { RouterProvider } from "react-router-dom";
import { router } from "./routing/RouteConfig";

export function AppRouter() {
  return <RouterProvider router={router} />;
}
