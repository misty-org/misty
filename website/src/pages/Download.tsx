import { GlowCard } from "../components/GlowCard";
import { SiApple, SiLinux } from "react-icons/si";
import { FaWindows } from "react-icons/fa6";

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
    available: false,
    accent: "from-success/20 to-success/5",
  },
];

const requirements = [
  { label: "OS", value: "Windows 10+, macOS 12+, or Linux (coming soon)" },
  { label: "RAM", value: "4 GB minimum, 8 GB recommended" },
  { label: "Storage", value: "100 MB for the application" },
  { label: "Network", value: "Internet connection for cloud access" },
];

export default function Download() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      {/* Header */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-surface/50 mb-6">
          <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          <span className="text-xs font-medium text-text-muted">Latest Release</span>
        </div>
        <h1 className="text-3xl md:text-5xl font-bold text-text mb-5 text-balance">
          Download Misty
        </h1>
        <p className="text-text-muted max-w-lg mx-auto text-pretty leading-relaxed">
          Fast, lightweight, and free. Get the Misty desktop app for your
          platform and bring all your files together.
        </p>
      </div>

      {/* Platform cards */}
      <div className="grid md:grid-cols-3 gap-5 max-w-3xl mx-auto mb-20">
        {platforms.map((platform) => (
          <GlowCard key={platform.name} className="h-full">
            <div className="p-7 text-center flex flex-col items-center">
              <div className={`w-16 h-16 rounded-2xl bg-gradient-to-b ${platform.accent} flex items-center justify-center mb-5 text-text-secondary`}>
                {platform.icon}
              </div>
              <h3 className="text-lg font-semibold text-text mb-1">
                {platform.name}
              </h3>
              <p className="text-sm text-text-muted mb-6">{platform.arch}</p>
              {platform.available ? (
                <button className="w-full px-4 py-3 bg-primary hover:bg-primary-hover text-text text-sm font-medium rounded-xl transition-all duration-300 shadow-lg shadow-primary/10 hover:shadow-primary/20 hover:-translate-y-0.5">
                  Download
                </button>
              ) : (
                <span className="inline-flex items-center justify-center w-full px-4 py-3 bg-elevated text-text-muted text-sm font-medium rounded-xl border border-border">
                  Coming Soon
                </span>
              )}
            </div>
          </GlowCard>
        ))}
      </div>

      {/* System requirements */}
      <div className="max-w-2xl mx-auto">
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
