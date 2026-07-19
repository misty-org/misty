import { useEffect, useState } from "react";
import { Outlet, useLocation, useMatches, ScrollRestoration, useNavigate } from "react-router";
import { AuthProvider } from "./AuthContext";
import Navbar from "./components/NavBar";
import { AccountSettingsDialog } from "./pages/Dashboard";

type Handle = { title?: string }

function getPageTransitionKey(pathname: string) {
  const [segment] = pathname.split("/").filter(Boolean);
  return segment ?? "home";
}


export default function App() {
  const matches = useMatches();
  const navigate = useNavigate();
  const location = useLocation();
  const pageTransitionKey = getPageTransitionKey(location.pathname);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const match = [...matches]
      .reverse()
      .find((routeMatch) => (routeMatch.handle as Handle | undefined)?.title);
    document.title = (match?.handle as Handle | undefined)?.title ?? "Misty";
    window.getSelection()?.removeAllRanges();
  }, [matches]);

  useEffect(() => {
    const { hash } = window.location;
    if (!hash.startsWith("#/")) {
      return;
    }

    navigate(hash.slice(1), { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (location.pathname !== "/settings") return;

    void Promise.resolve().then(() => {
      setSettingsOpen(true);
      navigate("/", { replace: true });
    });
  }, [location.pathname, navigate]);

  return (
    <AuthProvider>
      <ScrollRestoration />

      <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background text-foreground">
        <div className="ambient-background" aria-hidden="true" />
        <Navbar onOpenSettings={() => setSettingsOpen(true)} />
        
        <main className="relative z-10 flex-1">
          <div key={pageTransitionKey} className="page-transition">
            <Outlet />
          </div>
        </main>

        <AccountSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      </div>
    </AuthProvider>
  );
}
