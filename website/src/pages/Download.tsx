import { useState } from "react";
import { GlowCard } from "../components/GlowCard";
import { SiApple, SiLinux } from "react-icons/si";
import { FaWindows } from "react-icons/fa6";
import { HiOutlineArrowDownTray, HiOutlineChevronDown } from "react-icons/hi2";

const platforms = [
  {
    name: "Windows",
    arch: "x86_64",
    icon: <FaWindows className="w-8 h-8" />,
    available: true,
    accent: "from-primary/20 to-primary/5",
  },
  {
    name: "macOS",
    arch: "Apple Silicon / Intel",
    icon: <SiApple className="w-8 h-8" />,
    available: true,
    accent: "from-text-muted/20 to-text-muted/5",
  },
  {
    name: "Linux",
    arch: "x86_64 / ARM64",
    icon: <SiLinux className="w-8 h-8" />,
    available: true,
    accent: "from-success/20 to-success/5",
  },
];

const requirements = [
  { label: "OS", value: "Windows 10+, macOS 12+, or Linux" },
  { label: "RAM", value: "4 GB minimum, 8 GB recommended" },
  { label: "Storage", value: "100 MB for the application" },
  { label: "Network", value: "Internet connection for cloud access" },
];

const releases = [
  {
    version: "v0.3.0",
    date: "March 2026",
    notes: [
      "Linux support for x86_64 and ARM64",
      "New drag-and-drop transfer interface",
      "Improved connection stability for Google Drive and OneDrive",
      "Dark mode refinements and accessibility improvements",
    ],
  },
  {
    version: "v0.2.1",
    date: "February 2026",
    notes: [
      "Fixed crash when reconnecting expired OAuth sessions",
      "Improved file upload progress reporting",
      "Minor UI polish and animation fixes",
    ],
  },
  {
    version: "v0.2.0",
    date: "January 2026",
    notes: [
      "Multi-account support for all providers",
      "Misty clipboard for cross-provider file operations",
      "Batch rename and bulk actions",
      "Performance improvements for large directories",
    ],
  },
  {
    version: "v0.1.0",
    date: "December 2025",
    notes: [
      "Initial release with Windows and macOS support",
      "Google Drive, OneDrive, and iCloud integration",
      "Unified file browser with search",
      "Secure local-only proxy architecture",
    ],
  },
];

function ReleaseItem({
  version,
  date,
  notes,
}: {
  version: string;
  date: string;
  notes: string[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-none">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-medium text-text hover:text-text transition-colors cursor-pointer"
      >
        <span>
          {version}{" "}
          <span className="text-text-muted font-normal">— {date}</span>
        </span>
        <HiOutlineChevronDown
          className={`w-4 h-4 shrink-0 text-text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul className="pb-4 pl-4 space-y-1.5">
          {notes.map((note) => (
            <li
              key={note}
              className="text-sm text-text-muted leading-relaxed list-disc"
            >
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Download() {
  return (
    <div className="max-w-4xl mx-auto px-4 pt-32 pb-20">
      {/* Header */}
      <div className="text-center mb-16">
        
        <h1 className="text-3xl md:text-5xl font-bold text-text mb-5 text-balance">
          Download
        </h1>
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-surface/50 mb-6">
          <HiOutlineArrowDownTray className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium text-text-muted">Latest Release</span>
        </div>
      </div>

      {/* Platform cards */}
      <div className="grid md:grid-cols-3 gap-5 mb-20">
        {platforms.map((platform) => (
          <GlowCard key={platform.name} className="h-full">
            <div className="p-7 text-center flex flex-col items-center">
              <div className={`w-16 h-16 rounded-2xl bg-linear-to-b ${platform.accent} flex items-center justify-center mb-5 text-text-secondary`}>
                {platform.icon}
              </div>
              <h3 className="text-lg font-semibold text-text mb-1">
                {platform.name}
              </h3>
              <p className="text-sm text-text-muted mb-6">{platform.arch}</p>
              <button className="w-full px-4 py-3 bg-white hover:bg-zinc-200 text-black text-sm font-medium rounded-xl transition-colors duration-300 shadow-lg">
                Download
              </button>
            </div>
          </GlowCard>
        ))}
      </div>

      {/* Releases */}
      <div className="mb-20">
        <h2 className="text-lg font-semibold text-text mb-6">Releases</h2>
        <div>
          {releases.map((release) => (
            <ReleaseItem
              key={release.version}
              version={release.version}
              date={release.date}
              notes={release.notes}
            />
          ))}
        </div>
      </div>

      {/* System requirements */}
      <div>
        <h2 className="text-xl font-semibold text-text mb-6 text-center">
          System Requirements
        </h2>
        <div className="glass-card rounded-2xl overflow-hidden">
          {requirements.map((req, i) => (
            <div
              key={req.label}
              className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-4 px-6 py-4 ${
                i < requirements.length - 1 ? "border-b border-border/50" : ""
              }`}
            >
              <span className="text-sm font-medium text-text-muted">{req.label}</span>
              <span className="text-sm text-text">{req.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
