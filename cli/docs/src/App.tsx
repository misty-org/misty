import { useEffect, useMemo, useState } from "react";
import { DocPageView } from "./components/DocPageView";
import { Header } from "./components/Header";
import { SearchDialog } from "./components/SearchDialog";
import { Sidebar } from "./components/Sidebar";
import { pages } from "./content";

function normalizedPath() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return pages.some((page) => page.path === path) ? path : "/";
}

function preferredDarkTheme() {
  const saved = window.localStorage.getItem("misty-docs-theme");
  if (saved) return saved === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export default function App() {
  const [path, setPath] = useState(normalizedPath);
  const [dark, setDark] = useState(preferredDarkTheme);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const index = Math.max(
    0,
    pages.findIndex((page) => page.path === path),
  );
  const page = pages[index];

  function navigate(nextPath: string) {
    if (nextPath !== path) {
      window.history.pushState({}, "", nextPath);
      setPath(nextPath);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  useEffect(() => {
    const onPopState = () => setPath(normalizedPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setMobileOpen(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    window.localStorage.setItem("misty-docs-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    document.title = `${page.title} — Misty CLI`;
  }, [page]);

  const adjacent = useMemo(
    () => ({
      previous: index > 0 ? pages[index - 1] : undefined,
      next: index < pages.length - 1 ? pages[index + 1] : undefined,
    }),
    [index],
  );

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Header
        dark={dark}
        onMenu={() => setMobileOpen(true)}
        onNavigate={navigate}
        onSearch={() => setSearchOpen(true)}
        onTheme={() => setDark((value) => !value)}
      />
      <Sidebar
        currentPath={path}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onNavigate={navigate}
        onSearch={() => setSearchOpen(true)}
      />
      <DocPageView
        page={page}
        previous={adjacent.previous}
        next={adjacent.next}
        onNavigate={navigate}
      />
      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={navigate}
      />
    </>
  );
}
