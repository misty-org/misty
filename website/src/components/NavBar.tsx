import { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router";
import { useAuth } from "../AuthContext";

const navItems = [
  { to: "/download", label: "Download" },
  { to: "/pricing", label: "Pricing" },
];

const docsLinks = [
  { to: "/docs", label: "Getting Started" },
  { to: "/docs/api", label: "API Reference" },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "";

  // Close menus on route change
  useEffect(() => {
    setMenuOpen(false);
    setProfileOpen(false);
  }, [location]);

  // Handle scroll effect
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!profileOpen) return;
    const handleClick = () => setProfileOpen(false);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [profileOpen]);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      scrolled ? "glass shadow-lg shadow-bg/50" : "bg-transparent"
    }`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <NavLink to="/" className="group flex items-center gap-1">
          <img src="/misty_full.png" alt="Misty logo" className="w-12 h-12 transition-transform duration-300 group-hover:scale-110" />
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
                isActive ? "text-text" : "text-text-muted hover:text-text"
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
          <div className="relative group">
            <NavLink
              to="/docs"
              className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 block ${
                location.pathname.startsWith("/docs") ? "text-text" : "text-text-muted hover:text-text"
              }`}
            >
              Docs
              {location.pathname.startsWith("/docs") && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-primary rounded-full" />}
            </NavLink>
            <div className="absolute left-1/2 -translate-x-1/2 top-full pt-1 w-44 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
              <div className="glass-card rounded-xl overflow-hidden shadow-xl shadow-bg/50">
                {docsLinks.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end
                    className={({ isActive }) => `block px-4 py-2.5 text-sm transition-colors ${
                      isActive ? "text-primary bg-primary/10" : "text-text-muted hover:text-text hover:bg-elevated"
                    }`}
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
          <div className="ml-4 pl-4 border-l border-border">
            {user ? (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setProfileOpen(!profileOpen); }}
                  className="w-8 h-8 rounded-full bg-primary hover:bg-primary-hover flex items-center justify-center text-xs font-semibold text-text transition-colors"
                >
                  {initials}
                </button>
                {profileOpen && (
                  <div className="absolute right-0 mt-2 w-48 glass-card rounded-xl overflow-hidden shadow-xl shadow-bg/50">
                    <div className="px-4 py-3 border-b border-border/50">
                      <p className="text-sm font-medium text-text truncate">{user.name}</p>
                      <p className="text-xs text-text-muted truncate">{user.email}</p>
                    </div>
                    <button onClick={logout} className="w-full px-4 py-2.5 text-left text-sm text-text-muted hover:text-text hover:bg-elevated transition-colors">
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => navigate("/signin", { state: { from: location.pathname } })}
                className="px-4 py-1.5 bg-text hover:bg-text-secondary text-bg text-sm font-medium rounded-lg transition-all duration-200"
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
            {user ? (
              <div className="mt-2 flex items-center gap-3 px-4 py-2.5 border-t border-border/30">
                <span className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs font-semibold text-text">{initials}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text truncate">{user.name}</p>
                  <p className="text-xs text-text-muted truncate">{user.email}</p>
                </div>
              </div>
            ) : (
              <button onClick={() => navigate("/signin")} className="mt-2 px-4 py-2.5 bg-text text-bg text-sm font-medium rounded-lg">Sign In</button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
