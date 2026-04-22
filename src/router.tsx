import { createBrowserRouter } from "react-router";
import App from "./App";
import Home from "./pages/Home";
import Download from "./pages/Download";
import Pricing from "./pages/Pricing";
import SignIn from "./pages/SignIn";
import Register from "./pages/Register";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import Waitlist from "./pages/Waitlist";
import Docs from "./pages/Docs";
import Settings from "./pages/Dashboard";
import Changelog from "./pages/Changelog";
import Blog from "./pages/Blog";
import Roadmap from "./pages/Roadmap";
import Forum from "./pages/Forum";



export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Home />, handle: { title: "Misty - Home" } },
      { path: "docs", element: <Docs />, handle: { title: "Misty - Docs" } },
      { path: "settings", element: <Settings />, handle: { title: "Misty - Settings" } },
      { path: "download", element: <Download />, handle: { title: "Misty - Download" } },
      { path: "pricing", element: <Pricing />, handle: { title: "Misty - Pricing" } },
      { path: "changelog", element: <Changelog />, handle: { title: "Misty - Changelog" } },
      { path: "blog", element: <Blog />, handle: { title: "Misty - Blog" } },
      { path: "roadmap", element: <Roadmap />, handle: { title: "Misty - Roadmap" } },
      { path: "forum", element: <Forum />, handle: { title: "Misty - Forum" } },
      { path: "waitlist", element: <Waitlist />, handle: { title: "Misty - Waitlist" } },
      { path: "signin", element: <SignIn />, handle: { title: "Misty - Sign In" } },
      { path: "register", element: <Register />, handle: { title: "Misty - Register" } },
      { path: "reset", element: <ResetPassword />, handle: { title: "Misty - Reset Password" } },
      { path: "*", element: <NotFound />, handle: { title: "Misty - Not Found" } },
    ],
  },
]);
