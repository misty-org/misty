import { BrowserRouter } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { AuthProvider } from "./features/hub/AuthContext";
import { RenderErrorBoundary } from "./shared/components/RenderErrorBoundary";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <RenderErrorBoundary>
          <AppShell />
        </RenderErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}
