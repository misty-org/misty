import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import "./providers.css";

export type PlatformEntry = {
  id: string;
  label: string;
  icon: ReactNode;
  description: string;
  added: boolean;
  onSelect(): void;
  onOpen(): void;
};

/** A single searchable list, shared by every app with providers. */
export function PlatformDirectory({
  title,
  entries,
  loading,
  error,
  onRetry,
  busy,
  embedded = false,
  children,
}: {
  title: string;
  entries: PlatformEntry[];
  loading: boolean;
  error?: string;
  onRetry(): void;
  busy?: string;
  embedded?: boolean;
  children?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const filtered = entries.filter((entry) =>
    `${entry.label} ${entry.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <section
      className="provider-workspace provider-directory"
      data-embedded={embedded}
      aria-busy={loading || Boolean(busy)}
    >
      {!embedded && (
        <header>
          <h1>{title}</h1>
        </header>
      )}
      <label className="website-search">
        <Search aria-hidden size={16} />
        <input
          aria-label={`Search ${title}`}
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="provider-directory-error">
          {error} <button onClick={onRetry}>Retry</button>
        </p>
      )}
      {loading && !error && <p role="status">Loading…</p>}
      <div
        className="provider-integration-list"
        aria-label={`${title} platforms`}
      >
        {!query && children}
        {filtered.map((entry) => (
          <div
            className="provider-integration-row"
            key={entry.id}
            data-integration={entry.id}
          >
            <button
              className="platform-entry"
              onClick={entry.onSelect}
              disabled={!!busy}
              aria-label={entry.label}
            >
              <span className="provider-integration-icon">{entry.icon}</span>
              <span className="provider-integration-copy">
                <strong>{entry.label}</strong>
                {entry.description && <small>{entry.description}</small>}
              </span>
            </button>
            <button
              className="platform-action"
              disabled={!!busy}
              aria-label={`${entry.added ? "Open" : "Add"} ${entry.label}`}
              onClick={entry.onOpen}
            >
              {busy === entry.id ? "Opening…" : entry.added ? "Open" : "Add"}
            </button>
          </div>
        ))}
      </div>
      {!loading && !error && !filtered.length && (
        <p role="status">No matches. Try another name.</p>
      )}
    </section>
  );
}
