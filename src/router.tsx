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



export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <Home />,
        handle: {
          title: "Misty — One Space for the whole project",
          description:
            "Misty combines members, chat, tasks, and a shared Library in one project Space. Private Files stay private until shared.",
        },
      },
      {
        path: "settings",
        element: <Settings />,
        handle: {
          title: "Account settings — Misty",
          description: "Manage your Misty account, credits, and billing.",
        },
      },
      {
        path: "download",
        element: <Download />,
        handle: {
          title: "Download Misty — macOS and Windows beta",
          description: "Download the Misty beta for Apple Silicon Macs or 64-bit Windows PCs.",
        },
      },
      {
        path: "pricing",
        element: <Pricing />,
        handle: {
          title: "Pricing — Plans for every project group | Misty",
          description: "Compare Misty Free, Pro, and Max limits for Spaces, members, Library storage, and Mika.",
        },
      },
      {
        path: "changelog",
        element: <Changelog />,
        handle: {
          title: "Changelog — Misty beta updates",
          description: "See what changed across Misty Spaces, Files, and the beta experience.",
        },
      },
      {
        path: "blog",
        element: <Blog />,
        handle: {
          title: "Blog — Notes from Misty",
          description: "Historical announcements and product notes from the Misty team.",
        },
      },
      {
        path: "roadmap",
        element: <Roadmap />,
        handle: {
          title: "Roadmap — What Misty is building",
          description: "Follow the current beta, connector pilots, and next steps for Misty.",
        },
      },
      {
        path: "features",
        element: <Features />,
        handle: {
          title: "Features — Work together in one Space | Misty",
          description: "Explore Misty Chat, Library, Tasks, Members, private Files, connector pilots, and Space-aware Mika.",
        },
      },
      {
        path: "waitlist",
        element: <Waitlist />,
        handle: {
          title: "Request beta access — Misty",
          description: "Request invite-only access to the Misty beta for your project group.",
        },
      },
      {
        path: "signin",
        element: <SignIn />,
        handle: { title: "Sign in — Misty", description: "Sign in to your Misty account." },
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
        handle: { title: "Reset your password — Misty", description: "Reset your Misty account password." },
      },
      {
        path: "*",
        element: <NotFound />,
        handle: { title: "Page not found — Misty", description: "The requested Misty page could not be found." },
      },
    ],
  },
]);
