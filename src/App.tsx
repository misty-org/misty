import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useMatches, ScrollRestoration, useNavigate } from "react-router";
import { AuthProvider } from "./AuthContext";
import Navbar from "./components/NavBar";
import Footer from "./components/Footer";
import { AccountSettingsDialog } from "./pages/Dashboard";
import { SITE_URL } from "./lib/site";

type Handle = { title?: string; description?: string };

function setMeta(selector: string, attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}


export default function App() {
  const matches = useMatches();
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousPathRef = useRef(location.pathname);

  useEffect(() => {
    const match = [...matches]
      .reverse()
      .find((routeMatch) => Boolean(routeMatch.handle as Handle | undefined));
    const handle = match?.handle as Handle | undefined;
    const title = handle?.title ?? "Misty — One shared Space for everyone";
    const description =
      handle?.description ??
      "Misty combines members, chat, tasks, a shared Library, and AI Agents in one shared Space. Private Files stay private until shared.";
    const canonicalUrl = new URL(location.pathname, SITE_URL).toString();

    document.title = title;
    setMeta('meta[name="description"]', "name", "description", description);
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    setMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }, [location.pathname, matches]);

  // Cross-page anchors (e.g. "/features#spaces" from the home hero). Router
  // navigation does not scroll to the hash on its own, so do it once the target
  // route has rendered.
  useEffect(() => {
    if (!location.hash || location.hash.startsWith("#/")) return;

    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector(location.hash);
      target?.scrollIntoView({ block: "start" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = location.pathname;

    if (previousPath === location.pathname || location.pathname === "/settings") return;

    const frame = window.requestAnimationFrame(() => {
      const heading = mainRef.current?.querySelector<HTMLElement>("h1");
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

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
        <a
          href="#main-content"
          className="sr-only fixed left-4 top-4 z-[100] rounded-md bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring"
          onClick={() => mainRef.current?.focus()}
        >
          Skip to content
        </a>
        <Navbar onOpenSettings={() => setSettingsOpen(true)} />
        
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="relative z-10 flex-1 outline-none"
        >
          <Outlet />
        </main>

        <Footer />
        <AccountSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      </div>
    </AuthProvider>
  );
}
