import { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router";
import { useAuth } from "../AuthContext";

const navItems = [
  { to: "/download", label: "Download" },
  { to: "/pricing", label: "Pricing" },
];

const docsLinks = [
  { to: "/docs", label: "Guide" },
];

const resourcesLinks = [
  { to: "/changelog", label: "Changelog" },
  { to: "/blog", label: "Blog" },
  { to: "/roadmap", label: "Roadmap" },
  { to: "/forum", label: "Forum" },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    setMenuOpen(false);
    setDocsOpen(false);
    setResourcesOpen(false);
  }, [location]);

  useEffect(() => {
    const handleScroll = () => {};
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function openDocs() {
    setResourcesOpen(false);
    setDocsOpen(true);
  }

  function openResources() {
    setDocsOpen(false);
    setResourcesOpen(true);
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-[#07090b]">
      <div
        style={{
          maxWidth: location.pathname === "/" ? "1000px" : "100%",
          transition: "max-width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        className="w-full mx-auto px-4 h-16 flex items-center justify-between"
      >
        <NavLink to="/" className="group flex items-center gap-1">
          <img src="/misty.png" alt="Misty logo" className="w-12 h-12" />
          <span className="text-lg font-semibold text-text tracking-tight">Misty</span>
        </NavLink>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => `relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive ? "text-white" : "text-text hover:text-white"
              }`}
            >
              {({ isActive }) => (
                <>
                  {label}
                  {isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-primary rounded-full" />}
                </>
              )}
            </NavLink>
          ))}

          {/* Docs dropdown */}
          <div className="relative" onMouseEnter={openDocs} onMouseLeave={() => setDocsOpen(false)}>
            <NavLink
              to="/docs"
              onClick={() => setDocsOpen(false)}
              className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 block ${
                location.pathname.startsWith("/docs") ? "text-white" : "text-text hover:text-white"
              }`}
            >
              Docs
              {location.pathname.startsWith("/docs") && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-primary rounded-full" />}
            </NavLink>
            <div className={`absolute left-1/2 -translate-x-1/2 top-full pt-1 w-44 transition-all duration-200 ${docsOpen ? "opacity-100 visible" : "opacity-0 invisible"}`}>
              <div className="glass-card rounded-xl overflow-hidden shadow-xl shadow-bg/50">
                {docsLinks.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end
                    className={({ isActive }) => `block px-4 py-2.5 text-sm transition-colors ${
                      isActive ? "text-white bg-primary/10" : "text-text hover:text-white hover:bg-elevated"
                    }`}
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>

          {/* Resources dropdown */}
          <div className="relative" onMouseEnter={openResources} onMouseLeave={() => setResourcesOpen(false)}>
            <NavLink
              to="/changelog"
              onClick={() => setResourcesOpen(false)}
              className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 block ${
                resourcesLinks.some(({ to }) => location.pathname.startsWith(to)) ? "text-white" : "text-text hover:text-white"
              }`}
            >
              Resources
              {resourcesLinks.some(({ to }) => location.pathname.startsWith(to)) && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-primary rounded-full" />}
            </NavLink>
            <div className={`absolute left-1/2 -translate-x-1/2 top-full pt-1 w-44 transition-all duration-200 ${resourcesOpen ? "opacity-100 visible" : "opacity-0 invisible"}`}>
              <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-xl shadow-bg/50">
                {resourcesLinks.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end
                    className={({ isActive }) => `block px-4 py-2.5 text-sm transition-colors ${
                      isActive ? "text-white bg-primary/10" : "text-text hover:text-white hover:bg-elevated"
                    }`}
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>

          <div className="pl-4 border-l border-border">
            {user ? (
              <NavLink
                to="/settings"
                className={({ isActive }) => `relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 block ${
                  isActive ? "text-white" : "text-text hover:text-white"
                }`}
              >
                {({ isActive }) => (
                  <>
                    Settings
                    {isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-primary rounded-full" />}
                  </>
                )}
              </NavLink>
            ) : (
              <button
                onClick={() => navigate("/signin", { state: { from: location.pathname } })}
                className="px-4 py-1.5 bg-white hover:bg-zinc-200 text-bg text-sm font-medium rounded-lg transition-colors duration-200"
              >
                Sign In
              </button>
            )}
          </div>
        </div>

        {/* Mobile hamburger */}
        <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden relative w-10 h-10 flex items-center justify-center text-text-muted hover:text-text transition-colors">
          <div className="flex flex-col gap-1.5">
            <span className={`block w-5 h-px bg-current transition-all duration-300 ${menuOpen ? "rotate-45 translate-y-[3.5px]" : ""}`} />
            <span className={`block w-5 h-px bg-current transition-all duration-300 ${menuOpen ? "-rotate-45 -translate-y-[3.5px]" : ""}`} />
          </div>
        </button>
      </div>

      {/* Mobile menu */}
      <div className={`md:hidden overflow-hidden transition-all duration-300 ${menuOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="px-6 py-4 border-t border-border/50 glass">
          <div className="flex flex-col gap-1">
            {navItems.map(({ to, label }) => (
              <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? "text-primary bg-primary/10" : "text-text-muted hover:text-text hover:bg-elevated"
              }`}>
                {label}
              </NavLink>
            ))}
            <span className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-text-muted">Docs</span>
            {docsLinks.map(({ to, label }) => (
              <NavLink key={to} to={to} end className={({ isActive }) => `px-4 pl-6 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? "text-primary bg-primary/10" : "text-text-muted hover:text-text hover:bg-elevated"
              }`}>
                {label}
              </NavLink>
            ))}
            <span className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-text-muted">Resources</span>
            {resourcesLinks.map(({ to, label }) => (
              <NavLink key={to} to={to} end className={({ isActive }) => `px-4 pl-6 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? "text-primary bg-primary/10" : "text-text-muted hover:text-text hover:bg-elevated"
              }`}>
                {label}
              </NavLink>
            ))}
            {user ? (
              <NavLink to="/settings" className={({ isActive }) => `mt-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? "text-primary bg-primary/10" : "text-text-muted hover:text-text hover:bg-elevated"
              }`}>
                Settings
              </NavLink>
            ) : (
              <button onClick={() => navigate("/signin")} className="mt-2 px-4 py-2.5 bg-white text-bg text-sm font-medium rounded-lg">Sign In</button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
