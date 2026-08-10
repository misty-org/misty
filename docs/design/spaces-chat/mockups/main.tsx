import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@/styles/styles.css";
import "@/styles/App.css";
import "./preview.css";
import { App } from "./App";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
