import { AnimateIn } from "../components/AnimateIn";
import { GlowCard } from "../components/GlowCard";

const platforms = [
  {
    name: "Windows",
    arch: "x86_64",
    icon: (
      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
      </svg>
    ),
    available: true,
    accent: "from-primary/20 to-primary/5",
  },
  {
    name: "macOS",
    arch: "Apple Silicon / Intel",
    icon: (
      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    ),
    available: true,
    accent: "from-text-muted/20 to-text-muted/5",
  },
  {
    name: "Linux",
    arch: "x86_64 / ARM64",
    icon: (
      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.43.868.07 1.723-.26 2.456-.594.733-.34 1.455-.737 2.112-.766.658-.03 1.157.218 1.376.822a.597.597 0 00.429.332c.173.025.393-.004.6-.065.41-.118.856-.367.856-.367.457-.213.912-.502.912-.838 0-.109-.043-.216-.109-.335-.154-.278-.357-.613-.497-.93a12.685 12.685 0 01-.443-1.152 6.337 6.337 0 01-.291-1.368c-.022-.297.017-.566.175-.764.322-.405.795-.577 1.175-.819.38-.24.703-.545.84-.956.137-.406.086-.868-.058-1.344-.189-.513-.456-1.087-.648-1.539-.127-.36-.237-.681-.246-.935-.063-1.333-.498-2.666-.93-3.804a8.48 8.48 0 00-1.692-2.677C17.106.965 15.032 0 12.504 0z" />
      </svg>
    ),
    available: false,
    accent: "from-success/20 to-success/5",
  },
];

const requirements = [
  { label: "OS", value: "Windows 10+, macOS 12+, or Linux (coming soon)" },
  { label: "RAM", value: "4 GB minimum, 8 GB recommended" },
  { label: "Storage", value: "100 MB for the application" },
  { label: "Network", value: "Tailscale (optional, for P2P)" },
];

export default function Download() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      {/* Header */}
      <AnimateIn animation="fade-in-up">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-surface/50 mb-6">
            <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span className="text-xs font-medium text-text-muted">Latest Release</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-text mb-5 text-balance">
            Download Misty
          </h1>
          <p className="text-text-muted max-w-lg mx-auto text-pretty leading-relaxed">
            Get the native desktop client for your platform. Built with ImGui and
            OpenGL for a fast, lightweight experience.
          </p>
        </div>
      </AnimateIn>

      {/* Platform cards */}
      <div className="grid md:grid-cols-3 gap-5 max-w-3xl mx-auto mb-20">
        {platforms.map((platform, i) => (
          <AnimateIn key={platform.name} delay={i * 100} animation="fade-in-up">
            <GlowCard className="h-full">
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
          </AnimateIn>
        ))}
      </div>

      {/* System requirements */}
      <AnimateIn animation="fade-in-up">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-semibold text-text mb-6 text-center">
            System Requirements
          </h2>
          <div className="glass-card rounded-2xl overflow-hidden">
            {requirements.map((req, i) => (
              <div
                key={req.label}
                className={`flex items-center justify-between px-6 py-4 ${
                  i < requirements.length - 1 ? "border-b border-border/50" : ""
                }`}
              >
                <span className="text-sm font-medium text-text-muted">{req.label}</span>
                <span className="text-sm text-text">{req.value}</span>
              </div>
            ))}
          </div>
        </div>
      </AnimateIn>

      {/* Build from source */}
      <AnimateIn animation="fade-in" delay={200}>
        <div className="mt-16 text-center">
          <p className="text-sm text-text-muted">
            Misty is open source.{" "}
            <a
              href="https://github.com/kannachi323/misty"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary-hover transition-colors font-medium"
            >
              Build from source
            </a>{" "}
            if you prefer.
          </p>
        </div>
      </AnimateIn>
    </div>
  );
}
