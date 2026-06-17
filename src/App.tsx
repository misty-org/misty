import { useEffect } from "react";
import { Outlet, useLocation, useMatches, ScrollRestoration, useNavigate } from "react-router";
import { AuthProvider } from "./AuthContext";
import Navbar from "./components/NavBar";

type Handle = { title: string }

function getPageTransitionKey(pathname: string) {
  const [segment] = pathname.split("/").filter(Boolean);
  return segment ?? "home";
}


export default function App() {
  const matches = useMatches();
  const navigate = useNavigate();
  const location = useLocation();
  const pageTransitionKey = getPageTransitionKey(location.pathname);

  useEffect(() => {
    const match = [...matches].reverse().find((m) => (m.handle as Handle)?.title);
    document.title = (match?.handle as any)?.title;
    window.getSelection()?.removeAllRanges();
  }, [matches]);

  useEffect(() => {
    const { hash } = window.location;
    if (!hash.startsWith("#/")) {
      return;
    }

    navigate(hash.slice(1), { replace: true });
  }, [navigate]);

  return (
    <AuthProvider>
      <ScrollRestoration />

      <div className="relative flex min-h-screen flex-col overflow-hidden bg-bg">
        <div className="ambient-background" aria-hidden="true" />
        <Navbar />
        
        <main className="relative z-10 flex-1">
          <div key={pageTransitionKey} className="page-transition">
            <Outlet />
          </div>
        </main>

      </div>
    </AuthProvider>
  );
}
