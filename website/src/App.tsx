import { useEffect, useRef, useState } from "react";
import {
  Outlet,
  useLocation,
  useMatches,
  ScrollRestoration,
  useNavigate,
} from "react-router";
import { AuthProvider } from "./AuthContext";
import Navbar from "./components/layout/NavBar";
import Footer from "./components/layout/Footer";
import { AccountSettingsDialog } from "./pages/AccountSettings";
import {
  isSettingsPathname,
  settingsPathForTab,
  settingsTabFromPathname,
} from "./pages/AccountSettings/settingsRoute";
import { TABS } from "./pages/AccountSettings/tabs";
import { SITE_URL } from "./lib/site";

type Handle = { title?: string; description?: string };

function setMeta(
  selector: string,
  attribute: "name" | "property",
  key: string,
  content: string,
) {
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

  const onSettingsRoute = isSettingsPathname(location.pathname);
  const routeTab = settingsTabFromPathname(location.pathname);

  useEffect(() => {
    const match = [...matches]
      .reverse()
      .find((routeMatch) => Boolean(routeMatch.handle as Handle | undefined));
    const handle = match?.handle as Handle | undefined;
    const checkoutSucceeded =
      location.pathname === "/pricing" &&
      new URLSearchParams(location.search).get("checkout") === "success";
    const title = checkoutSucceeded
      ? "Plan upgraded — Misty"
      : (handle?.title ?? "Misty — Organize, create, and collaborate");
    const description = checkoutSucceeded
      ? "Your Misty plan and billing details have been updated."
      : (handle?.description ??
        "Misty is a fast, lightweight workspace with built-in apps for organizing, creating, and collaborating.");
    const canonicalUrl = new URL(location.pathname, SITE_URL).toString();

    document.title = title;
    setMeta('meta[name="description"]', "name", "description", description);
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta(
      'meta[property="og:description"]',
      "property",
      "og:description",
      description,
    );
    setMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    setMeta(
      'meta[name="twitter:description"]',
      "name",
      "twitter:description",
      description,
    );

    let canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }, [location.pathname, location.search, matches]);

  // Cross-page anchors (e.g. "/#features" from another page). Router
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

    // The dialog owns its own focus trap, so never steal focus to the page h1
    // underneath it.
    if (previousPath === location.pathname || onSettingsRoute) return;

    const frame = window.requestAnimationFrame(() => {
      const heading = mainRef.current?.querySelector<HTMLElement>("h1");
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, onSettingsRoute]);

  useEffect(() => {
    const { hash } = window.location;
    if (!hash.startsWith("#/")) {
      return;
    }

    navigate(hash.slice(1), { replace: true });
  }, [navigate]);

  // A settings URL drives the dialog directly: the path stays put so the page is
  // shareable, reloadable, and a valid desktop hand-off target. An unknown tab
  // falls back to the default rather than rendering an empty page.
  useEffect(() => {
    if (!onSettingsRoute || routeTab !== null) return;

    navigate(settingsPathForTab(TABS[0].id), { replace: true });
  }, [onSettingsRoute, routeTab, navigate]);

  function handleSettingsOpenChange(next: boolean) {
    if (next) {
      setSettingsOpen(true);
      return;
    }
    setSettingsOpen(false);
    // Closing a settings URL has to leave the URL too, or the dialog reopens on
    // the next render.
    if (onSettingsRoute) navigate("/", { replace: true });
  }

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
          className="relative z-10 min-h-[100svh] w-full min-w-0 flex-1 outline-none"
        >
          <div
            key={location.pathname}
            data-page-transition={location.pathname}
            className="page-transition w-full min-w-0"
          >
            <Outlet />
          </div>
        </main>

        <Footer />
        <AccountSettingsDialog
          open={settingsOpen || routeTab !== null}
          onOpenChange={handleSettingsOpenChange}
          tab={routeTab ?? undefined}
          onTabChange={
            routeTab !== null
              ? (tab) => navigate(settingsPathForTab(tab), { replace: true })
              : undefined
          }
        />
      </div>
    </AuthProvider>
  );
}
