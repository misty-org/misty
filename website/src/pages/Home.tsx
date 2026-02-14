import { NavLink } from "react-router";
import { AnimateIn } from "../components/AnimateIn";
import { GlowCard } from "../components/GlowCard";
import { ParticleField } from "../components/ParticleField";

const features = [
  {
    title: "Distributed Storage",
    description:
      "Stream files across nodes with gRPC-powered locking and chunked I/O. Built on a minimal DFS core written in C++20.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
  },
  {
    title: "Peer-to-Peer with Tailscale",
    description:
      "Connect devices securely over a Tailscale mesh network. Share files directly between peers without exposing ports.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    title: "Cloud Integration",
    description:
      "Mount OneDrive and Google Drive as virtual workspaces. Browse, upload, and sync cloud files alongside local storage.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
      </svg>
    ),
  },
  {
    title: "Cross-Platform",
    description:
      "Native desktop client built with ImGui and OpenGL. Runs on Windows, macOS, and Linux with platform-specific optimizations.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
      </svg>
    ),
  },
];

const stats = [
  { value: "C++20", label: "Core Engine" },
  { value: "gRPC", label: "Communication" },
  { value: "P2P", label: "Networking" },
  { value: "3", label: "Cloud Providers" },
];

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <ParticleField />
        <div className="radial-glow absolute inset-0 pointer-events-none" />
        <div className="absolute inset-0 grid-bg pointer-events-none" />

        <div className="max-w-6xl mx-auto px-6 pt-20 pb-28 md:pt-32 md:pb-40 text-center relative">
          <AnimateIn delay={0} animation="fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-surface/50 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-glow-pulse" />
              <span className="text-xs font-medium text-text-muted">
                Open Source Distributed File System
              </span>
            </div>
          </AnimateIn>

          <AnimateIn delay={100} animation="fade-in-up">
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold text-text tracking-tight mb-6 text-balance">
              Your files,
              <br />
              <span className="gradient-text">everywhere.</span>
            </h1>
          </AnimateIn>

          <AnimateIn delay={200} animation="fade-in-up">
            <p className="text-lg md:text-xl text-text-muted max-w-2xl mx-auto mb-12 leading-relaxed text-pretty">
              Misty is a distributed file system that connects your devices through
              Tailscale, syncs with the cloud, and puts you in control of your data.
            </p>
          </AnimateIn>

          <AnimateIn delay={300} animation="fade-in-up">
            <div className="flex gap-4 justify-center flex-wrap">
              <NavLink
                to="/download"
                className="group relative px-8 py-3.5 bg-primary hover:bg-primary-hover text-text font-medium rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5"
              >
                <span className="relative z-10">Download</span>
              </NavLink>
              <NavLink
                to="/docs"
                className="px-8 py-3.5 bg-transparent hover:bg-elevated text-text font-medium rounded-xl border border-border hover:border-text-muted/30 transition-all duration-300 hover:-translate-y-0.5"
              >
                Read the Docs
              </NavLink>
            </div>
          </AnimateIn>

          {/* Terminal preview */}
          <AnimateIn delay={500} animation="scale-in">
            <div className="mt-20 max-w-2xl mx-auto">
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-danger/60" />
                    <div className="w-3 h-3 rounded-full bg-text-muted/30" />
                    <div className="w-3 h-3 rounded-full bg-text-muted/30" />
                  </div>
                  <span className="text-xs text-text-muted font-mono ml-2">terminal</span>
                </div>
                <div className="p-5 font-mono text-sm text-left">
                  <div className="flex gap-2">
                    <span className="text-primary">$</span>
                    <span className="text-text-secondary">git clone https://github.com/kannachi323/misty.git</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <span className="text-primary">$</span>
                    <span className="text-text-secondary">cd misty && cmake -B build -S app</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <span className="text-primary">$</span>
                    <span className="text-text-secondary">cmake --build build --config Release</span>
                  </div>
                  <div className="mt-2 text-success">
                    {'>'} Build successful. Ready to connect.
                  </div>
                </div>
              </div>
            </div>
          </AnimateIn>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-border/50 bg-surface/30">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <AnimateIn key={stat.label} delay={i * 100} animation="fade-in">
                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-bold text-text mb-1">
                    {stat.value}
                  </div>
                  <div className="text-sm text-text-muted">{stat.label}</div>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <AnimateIn animation="fade-in">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-text mb-4 text-balance">
              Built for distributed workflows
            </h2>
            <p className="text-text-muted max-w-xl mx-auto text-pretty">
              Everything you need to manage files across devices, peers, and cloud
              providers in one unified system.
            </p>
          </div>
        </AnimateIn>

        <div className="grid md:grid-cols-2 gap-5">
          {features.map((feature, i) => (
            <AnimateIn key={feature.title} delay={i * 100} animation="fade-in-up">
              <GlowCard className="h-full">
                <div className="p-7">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-5">
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-text mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-text-muted leading-relaxed text-sm">
                    {feature.description}
                  </p>
                </div>
              </GlowCard>
            </AnimateIn>
          ))}
        </div>
      </section>

      {/* Architecture section */}
      <section className="border-t border-border/50">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <AnimateIn animation="fade-in-up">
              <div>
                <span className="text-xs font-medium text-primary uppercase tracking-wider">Architecture</span>
                <h2 className="text-3xl md:text-4xl font-bold text-text mt-3 mb-6 text-balance">
                  Three layers, one experience
                </h2>
                <p className="text-text-muted leading-relaxed mb-8 text-pretty">
                  Misty combines a C++20 DFS core for blazing-fast file operations,
                  a Go-based API proxy for HTTP bridging, and a native ImGui desktop
                  client for a seamless cross-platform experience.
                </p>
                <NavLink
                  to="/docs"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
                >
                  Learn more about the architecture
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </NavLink>
              </div>
            </AnimateIn>

            <AnimateIn delay={200} animation="fade-in-up">
              <div className="flex flex-col gap-4">
                {[
                  { name: "DFS Core", tech: "C++20, gRPC, Protobuf", color: "bg-primary" },
                  { name: "API Proxy", tech: "Go, chi, SQLite", color: "bg-success" },
                  { name: "Desktop Client", tech: "ImGui, OpenGL 3.3", color: "bg-text-muted" },
                ].map((layer) => (
                  <div
                    key={layer.name}
                    className="glass-card rounded-xl p-5 flex items-center gap-4 transition-all duration-300 hover:border-primary/30"
                  >
                    <div className={`w-2 h-10 rounded-full ${layer.color}`} />
                    <div>
                      <h3 className="text-sm font-semibold text-text">{layer.name}</h3>
                      <p className="text-xs text-text-muted font-mono mt-0.5">{layer.tech}</p>
                    </div>
                  </div>
                ))}
              </div>
            </AnimateIn>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 radial-glow pointer-events-none" />
        <div className="max-w-6xl mx-auto px-6 py-24 text-center relative">
          <AnimateIn animation="fade-in-up">
            <h2 className="text-3xl md:text-5xl font-bold text-text mb-5 text-balance">
              Ready to get started?
            </h2>
            <p className="text-text-muted mb-10 max-w-lg mx-auto text-pretty">
              Misty is open source and free to use. Set up your first node in minutes.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              <NavLink
                to="/download"
                className="px-8 py-3.5 bg-primary hover:bg-primary-hover text-text font-medium rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5"
              >
                Download Now
              </NavLink>
              <a
                href="https://github.com/kannachi323/misty"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3.5 bg-transparent hover:bg-elevated text-text font-medium rounded-xl border border-border hover:border-text-muted/30 transition-all duration-300 hover:-translate-y-0.5"
              >
                View on GitHub
              </a>
            </div>
          </AnimateIn>
        </div>
      </section>
    </div>
  );
}
