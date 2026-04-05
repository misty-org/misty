import { useState } from "react";
import { HiOutlineChevronDown } from "react-icons/hi2";

const changelog = [
  {
    version: "v0.3.0",
    date: "March 2026",
    summary: "Linux support & drag-and-drop transfers",
    changes: [
      "Linux support for x86_64 and ARM64",
      "New drag-and-drop transfer interface",
      "Improved connection stability for Google Drive and OneDrive",
      "Dark mode refinements and accessibility improvements",
    ],
  },
  {
    version: "v0.2.1",
    date: "February 2026",
    summary: "Stability & progress reporting",
    changes: [
      "Fixed crash when reconnecting expired OAuth sessions",
      "Improved file upload progress reporting",
      "Minor UI polish and animation fixes",
    ],
  },
  {
    version: "v0.2.0",
    date: "January 2026",
    summary: "Multi-account & clipboard",
    changes: [
      "Multi-account support for all providers",
      "Misty clipboard for cross-provider file operations",
      "Batch rename and bulk actions",
      "Performance improvements for large directories",
    ],
  },
  {
    version: "v0.1.0",
    date: "December 2025",
    summary: "Initial release",
    changes: [
      "ImGui-based desktop client with local file browsing",
      "Go backend proxy with gRPC communication",
      "Basic file operations (copy, move, delete)",
      "Cross-platform builds for Windows and macOS",
    ],
  },
];

export default function Changelog() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="max-w-4xl mx-auto px-4 pt-32 pb-20">
      <div className="mb-12">
        <h1 className="text-3xl md:text-5xl font-bold text-text mb-4">
          Changelog
        </h1>
        <p className="text-text-muted leading-relaxed">
          What's new, improved, and fixed in each release.
        </p>
      </div>

      <div className="space-y-3">
        {changelog.map((entry, index) => {
          const isOpen = openIndex === index;
          return (
            <div
              key={entry.version}
              className="rounded-xl border border-border overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-elevated/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <span className="text-sm font-mono text-primary bg-primary/10 px-2.5 py-1 rounded">
                    {entry.version}
                  </span>
                  <span className="text-text font-medium text-sm">
                    {entry.summary}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-muted hidden sm:inline">
                    {entry.date}
                  </span>
                  <HiOutlineChevronDown
                    className={`w-4 h-4 text-text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </div>
              </button>

              {isOpen && (
                <div className="px-6 pb-5 pt-1">
                  <ul className="space-y-2">
                    {entry.changes.map((change, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 text-sm text-text-muted"
                      >
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
    </div>
  );
}
