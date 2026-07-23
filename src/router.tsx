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
import Settings from "./pages/Dashboard";
import Changelog from "./pages/Changelog";
import Blog from "./pages/Blog";
import Roadmap from "./pages/Roadmap";
import Features from "./pages/Features";
import { marketingCopy } from "./content/marketingCopy";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <Home />,
        handle: {
          title: "Misty — One shared Space for everyone",
          description: marketingCopy.metadata.home,
        },
      },
      {
        path: "settings",
        element: <Settings />,
        handle: {
          title: "Account settings — Misty",
          description: "Manage your Misty account, usage, and billing.",
        },
      },
      {
        path: "download",
        element: <Download />,
        handle: {
          title: "Download Misty — macOS and Windows beta",
          description: marketingCopy.metadata.download,
        },
      },
      {
        path: "pricing",
        element: <Pricing />,
        handle: {
          title: "Pricing — Free and Pro plans | Misty",
          description: marketingCopy.metadata.pricing,
        },
      },
      {
        path: "changelog",
        element: <Changelog />,
        handle: {
          title: "Changelog — Misty beta updates",
          description: marketingCopy.metadata.changelog,
        },
      },
      {
        path: "blog",
        element: <Blog />,
        handle: {
          title: "Blog — Notes from Misty",
          description: marketingCopy.metadata.blog,
        },
      },
      {
        path: "roadmap",
        element: <Roadmap />,
        handle: {
          title: "Roadmap — What Misty is building",
          description: marketingCopy.metadata.roadmap,
        },
      },
      {
        path: "features",
        element: <Features />,
        handle: {
          title: "Features — Work together in one Space | Misty",
          description: marketingCopy.metadata.features,
        },
      },
      {
        path: "waitlist",
        element: <Waitlist />,
        handle: {
          title: "Request beta access — Misty",
          description: marketingCopy.metadata.waitlist,
        },
      },
      {
        path: "signin",
        element: <SignIn />,
        handle: {
          title: "Sign in — Misty",
          description: "Sign in to your Misty account.",
        },
      },
      {
        path: "register",
        element: <Register />,
        handle: {
          title: "Beta invitations — Misty",
          description: "Request invite-only access to create a Misty account.",
        },
      },
      {
        path: "reset",
        element: <ResetPassword />,
        handle: {
          title: "Reset your password — Misty",
          description: "Reset your Misty account password.",
        },
      },
      {
        path: "*",
        element: <NotFound />,
        handle: {
          title: "Page not found — Misty",
          description: "The requested Misty page could not be found.",
        },
      },
    ],
  },
]);
