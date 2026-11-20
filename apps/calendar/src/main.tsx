import "@misty/sdk/misty-theme.css";
import { MistyProvider } from "@misty/sdk-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MistyProvider
      pending={<p className="note">Setting up Calendar</p>}
      failed={(error) => <p className="note">{error.message}</p>}
    >
      <App />
    </MistyProvider>
  </StrictMode>,
);
