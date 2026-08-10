import { navGroups } from "../content";
import { CloseIcon } from "./Icons";

interface SidebarProps {
  currentPath: string;
  mobileOpen: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onSearch: () => void;
}

export function Sidebar({
  currentPath,
  mobileOpen,
  onClose,
  onNavigate,
  onSearch,
}: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-mobile-head">
          <span>Documentation</span>
          <button type="button" onClick={onClose} aria-label="Close navigation">
            <CloseIcon />
          </button>
        </div>
        <button type="button" className="sidebar-search" onClick={onSearch}>
          Search documentation
          <kbd>⌘K</kbd>
        </button>
        <nav aria-label="Documentation">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.title}>
              <h2>{group.title}</h2>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.path}
                  className={[
                    "nav-item",
                    item.command ? "command-item" : "",
                    currentPath === item.path ? "active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    onNavigate(item.path);
                    onClose();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          Local-first tooling
        </div>
      </aside>
    </>
  );
}
