import { useEffect, useState } from "react";
import { ChevronDown, Github, Menu, Moon, Search, Sun, X } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

const websiteOrigin = "https://mistysys.com";

export function WebsiteNavbar({
  onOpenSearch,
  onOpenDocsMenu,
  docsMenuOpen,
}: {
  onOpenSearch: () => void;
  onOpenDocsMenu: () => void;
  docsMenuOpen: boolean;
}) {
  const { theme, toggleTheme } = useTheme();
  const [compact, setCompact] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 60);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="docs-navbar">
      <div className={`navbar-width${compact ? " compact" : ""}`}>
        <div className="navbar-surface">
          <div className="navbar-row">
            <a href={websiteOrigin} className="navbar-brand" aria-label="Misty home">
              <span className="navbar-brand-mark" aria-hidden="true" />
              <span>Misty</span>
              <span className="navbar-divider" />
              <span className="navbar-product">Docs</span>
            </a>

            <nav className="navbar-desktop" aria-label="Primary navigation">
              <a href={`${websiteOrigin}/download`}>Download</a>
              <a href={`${websiteOrigin}/pricing`}>Pricing</a>
              <details className="navbar-resources">
                <summary>Resources <ChevronDown aria-hidden="true" /></summary>
                <div className="navbar-menu">
                  <a href={`${websiteOrigin}/blog`}>Blog</a>
                  <a href={`${websiteOrigin}/changelog`}>Changelog</a>
                  <a href={`${websiteOrigin}/roadmap`}>Roadmap</a>
                </div>
              </details>

              <span className="navbar-actions-divider" />
              <a className="navbar-icon-link" href="https://github.com/misty-org" aria-label="Misty on GitHub"><Github /></a>
              <a className="navbar-signin" href={`${websiteOrigin}/signin`}>Sign in</a>
              <button className="navbar-icon-link" type="button" onClick={toggleTheme} aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}>
                {theme === "dark" ? <Sun /> : <Moon />}
              </button>
            </nav>

            <div className="navbar-mobile-actions">
              <button type="button" onClick={onOpenSearch} aria-label="Search documentation"><Search /></button>
              <button type="button" onClick={toggleTheme} aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}>
                {theme === "dark" ? <Sun /> : <Moon />}
              </button>
              <button type="button" onClick={() => setMobileOpen((open) => !open)} aria-label={mobileOpen ? "Close website navigation" : "Open website navigation"}>
                {mobileOpen ? <X /> : <Menu />}
              </button>
            </div>
          </div>

          {mobileOpen && (
            <nav className="navbar-mobile-menu" aria-label="Mobile primary navigation">
              <a href={`${websiteOrigin}/download`}>Download</a>
              <a href={`${websiteOrigin}/pricing`}>Pricing</a>
              <a href={`${websiteOrigin}/blog`}>Blog</a>
              <a href={`${websiteOrigin}/changelog`}>Changelog</a>
              <a href={`${websiteOrigin}/roadmap`}>Roadmap</a>
              <a href={`${websiteOrigin}/signin`}>Sign in</a>
              <button type="button" onClick={() => { setMobileOpen(false); onOpenDocsMenu(); }}>
                {docsMenuOpen ? "Close docs navigation" : "Browse documentation"}
              </button>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
