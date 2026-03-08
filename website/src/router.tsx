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
      { index: true, element: <Home />, handle: { title: "Misty" } },
      { path: "docs", element: <Docs />, handle: { title: "Misty - Docs" } },
      { path: "docs/api", element: <ApiReference />, handle: { title: "Misty - API Reference" } },
      { path: "download", element: <Download />, handle: { title: "Misty - Download" } }  ,
      { path: "pricing", element: <Pricing />, handle: { title: "Misty - Pricing" } },
      { path: "waitlist", element: <Waitlist />, handle: { title: "Misty - Waitlist" } },
      { path: "signin", element: <SignIn />, handle: { title: "Misty - Sign In" } },
      { path: "register", element: <Register />, handle: { title: "Misty - Register" } },
    ],
  },
]);
