import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router";

const navItems = [
  { to: "/", label: "Home" },
  { to: "/download", label: "Download" },
  { to: "/pricing", label: "Pricing" },
  { to: "/about", label: "About" },
];

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "glass border-b border-border/50 shadow-lg shadow-bg/50"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <NavLink to="/" className="flex items-center gap-3 group">
            <img
              src="/misty.png"
              alt="Misty logo"
              className="w-8 h-8 transition-transform duration-300 group-hover:scale-110"
            />
            <span className="text-lg font-semibold text-text tracking-tight transition-colors group-hover:text-primary">
              Misty
            </span>
          </NavLink>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "text-text"
                      : "text-text-muted hover:text-text"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {label}
                    {isActive && (
                      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-primary rounded-full" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
            <div className="ml-4 pl-4 border-l border-border">
              <a
                href="https://github.com/kannachi323/misty"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                GitHub
              </a>
            </div>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden relative w-10 h-10 flex items-center justify-center text-text-muted hover:text-text transition-colors"
            aria-label="Toggle menu"
          >
            <div className="flex flex-col gap-1.5">
              <span
                className={`block w-5 h-px bg-current transition-all duration-300 ${
                  menuOpen ? "rotate-45 translate-y-[3.5px]" : ""
                }`}
              />
              <span
                className={`block w-5 h-px bg-current transition-all duration-300 ${
                  menuOpen ? "-rotate-45 -translate-y-[3.5px]" : ""
                }`}
              />
            </div>
          </button>
        </div>

        {/* Mobile menu */}
        <div
          className={`md:hidden overflow-hidden transition-all duration-300 ${
            menuOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="px-6 py-4 border-t border-border/50 glass">
            <div className="flex flex-col gap-1">
              {navItems.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "text-primary bg-primary/10"
                        : "text-text-muted hover:text-text hover:bg-elevated"
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* Spacer for fixed nav */}
      <div className="h-16" />

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border/50 mt-20">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row justify-between items-start gap-8">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <img src="/misty.png" alt="Misty logo" className="w-6 h-6 opacity-60" />
                <span className="text-sm font-medium text-text-muted">Misty</span>
              </div>
              <p className="text-sm text-text-muted/60 max-w-xs">
                All your cloud files and devices in one place.
                Simple, private, and free.
              </p>
            </div>

            <div className="flex gap-12">
              <div className="flex flex-col gap-3">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Product</span>
                <NavLink to="/download" className="text-sm text-text-muted/60 hover:text-text transition-colors">
                  Download
                </NavLink>
                <NavLink to="/pricing" className="text-sm text-text-muted/60 hover:text-text transition-colors">
                  Pricing
                </NavLink>
              </div>
              <div className="flex flex-col gap-3">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Resources</span>
                <a
                  href="https://github.com/kannachi323/misty"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-text-muted/60 hover:text-text transition-colors"
                >
                  GitHub
                </a>
                <NavLink to="/about" className="text-sm text-text-muted/60 hover:text-text transition-colors">
                  About
                </NavLink>
              </div>
            </div>
          </div>

          <div className="mt-12 pt-6 border-t border-border/30 flex flex-col md:flex-row justify-between items-center gap-4">
            <span className="text-xs text-text-muted/40">
              Built with care. Open source.
            </span>
            <span className="text-xs text-text-muted/40">
              Misty File Manager
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
