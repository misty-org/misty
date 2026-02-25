import { createBrowserRouter } from "react-router";
import App from "./App";
import Home from "./pages/Home";
import Download from "./pages/Download";
import Pricing from "./pages/Pricing";
import SignIn from "./pages/SignIn";
import Register from "./pages/Register";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: "download", element: <Download /> },
      { path: "pricing", element: <Pricing /> },
      { path: "signin", element: <SignIn /> },
      { path: "register", element: <Register /> },
    ],
  },
]);
