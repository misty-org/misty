import { GithubIcon, MenuIcon, MoonIcon, SearchIcon, SunIcon } from "./Icons";

interface HeaderProps {
  dark: boolean;
  onMenu: () => void;
  onNavigate: (path: string) => void;
  onSearch: () => void;
  onTheme: () => void;
}

export function Header({
  dark,
  onMenu,
  onNavigate,
  onSearch,
  onTheme,
}: HeaderProps) {
  return (
    <header className="site-header">
      <div className="header-brand">
        <button
          type="button"
          className="mobile-menu"
          onClick={onMenu}
          aria-label="Open navigation"
        >
          <MenuIcon />
        </button>
        <button
          type="button"
          className="brand-link"
          onClick={() => onNavigate("/")}
          aria-label="Misty CLI documentation home"
        >
          <span className="misty-mark" />
          <span className="slash">/</span>
          <span>Docs</span>
        </button>
        <span className="header-section">CLI</span>
      </div>

      <div className="header-actions">
        <button type="button" className="header-search" onClick={onSearch}>
          <SearchIcon />
          <span>Search docs</span>
          <kbd>⌘ K</kbd>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onTheme}
          aria-label={dark ? "Use light theme" : "Use dark theme"}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
        <a
          className="icon-button"
          href="https://github.com/misty-org/misty"
          target="_blank"
          rel="noreferrer"
          aria-label="View Misty on GitHub"
        >
          <GithubIcon />
        </a>
      </div>
    </header>
  );
}
