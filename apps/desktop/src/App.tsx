import { BrowserRouter } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { RenderErrorBoundary } from "./shared/components/RenderErrorBoundary";

export function App() {
  return (
    <BrowserRouter>
      <RenderErrorBoundary>
        <AppShell />
      </RenderErrorBoundary>
    </BrowserRouter>
  );
}
