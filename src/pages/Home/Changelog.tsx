import { useState } from "react";

const changelog = [
  {
    version: "v0.3.0",
    date: "Feb 2026",
    summary: "OneDrive integration & transfer queue",
    changes: [
      "Added OneDrive as a supported storage provider",
      "New transfer queue UI with real-time progress tracking",
      "gRPC streaming for large file transfers",
      "Bug fixes for OAuth token refresh flow",
    ],
  },
  {
    version: "v0.2.0",
    date: "Jan 2026",
    summary: "Google Drive support & unified browser",
    changes: [
      "Google Drive integration via proxy backend",
      "Unified file browser combining local and cloud files",
      "File indexing with PostgreSQL for fast search",
      "Initial Tailscale networking support",
    ],
  },
  {
    version: "v0.1.0",
    date: "Dec 2025",
    summary: "Initial release",
    changes: [
      "ImGui-based desktop client with local file browsing",
      "Go backend proxy with gRPC communication",
      "Basic file operations (copy, move, delete)",
      "Cross-platform builds for Windows and Linux",
    ],
  },
];

export default function Changelog() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div>
      <h2 className="text-3xl md:text-4xl font-bold text-text tracking-tight mb-4">
        Changelog
      </h2>

      <div className="space-y-3">
        {changelog.map((entry, index) => {
          const isOpen = openIndex === index;
          return (
            <div
              key={entry.version}
              className="rounded-xl border border-white/10 overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span className="text-sm font-mono text-primary bg-primary/10 px-2.5 py-1 rounded">
                    {entry.version}
                  </span>
                  <span className="text-text font-medium">{entry.summary}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-muted">{entry.date}</span>
                  <svg
                    className={`w-4 h-4 text-text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isOpen && (
                <div className="px-6 pb-5 pt-1">
                  <ul className="space-y-2">
                    {entry.changes.map((change, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-text-muted">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        {change}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-text-muted mt-6">
        
        <a href="https://forms.gle/your-form-id" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-zinc-300">
          See recent updates and changes to Misty &rarr;
        </a>
      </p>
    </div>
  );
}