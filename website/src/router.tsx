import { createBrowserRouter } from "react-router";
import App from "./App";
import Home from "./pages/Home";
import Download from "./pages/Download";
import Pricing from "./pages/Pricing";
import SignIn from "./pages/SignIn";
import Register from "./pages/Register";
import Waitlist from "./pages/Waitlist";
import Docs from "./pages/Docs";
import ApiReference from "./pages/Docs/ApiReference";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: "docs", element: <Docs /> },
      { path: "docs/api", element: <ApiReference /> },
      { path: "download", element: <Download /> },
      { path: "pricing", element: <Pricing /> },
      { path: "waitlist", element: <Waitlist />}, 
      { path: "signin", element: <SignIn /> },
      { path: "register", element: <Register /> },
    ],
  },
]);
