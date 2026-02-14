import { AnimateIn } from "../components/AnimateIn";
import { GlowCard } from "../components/GlowCard";

const stack = [
  {
    layer: "Desktop Client",
    tech: "C++20, ImGui, OpenGL 3.3, GLFW",
    description:
      "Cross-platform native application with a custom dark-themed UI. Handles file browsing, workspace management, and cloud service integration.",
    color: "bg-text-muted",
  },
  {
    layer: "DFS Core",
    tech: "C++20, gRPC, Protobuf",
    description:
      "Minimal distributed file system with streaming I/O, file locking, and chunked transfers. Designed as an educational project with practical utility.",
    color: "bg-primary",
  },
  {
    layer: "API Proxy",
    tech: "Go, chi, SQLite, gRPC",
    description:
      "Lightweight HTTP gateway that bridges REST clients to the gRPC backend. Manages authentication, devices, and workspaces.",
    color: "bg-success",
  },
  {
    layer: "Networking",
    tech: "Tailscale, WireGuard",
    description:
      "Secure mesh networking for peer-to-peer file sharing. No port forwarding or public exposure required.",
    color: "bg-primary-hover",
  },
  {
    layer: "Cloud Integration",
    tech: "OAuth2, OneDrive API, Google Drive API",
    description:
      "Mount cloud storage providers as virtual workspaces. Browse and manage cloud files alongside local storage.",
    color: "bg-danger",
  },
];

const values = [
  {
    title: "Open Source",
    description: "Every line of code is publicly available. Transparency is fundamental to trust.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
  {
    title: "Privacy First",
    description: "Your data stays on your devices. Misty never routes files through external servers.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    title: "Educational",
    description: "Built as a learning project for distributed systems, then grown into a real tool.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
      </svg>
    ),
  },
];

export default function About() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      {/* Hero */}
      <AnimateIn animation="fade-in-up">
        <div className="max-w-3xl mb-20">
          <span className="text-xs font-medium text-primary uppercase tracking-wider">About</span>
          <h1 className="text-4xl md:text-5xl font-bold text-text mt-3 mb-8 text-balance">
            A file system built for
            <br />
            <span className="gradient-text">the modern developer</span>
          </h1>
          <div className="flex flex-col gap-5 text-text-muted leading-relaxed">
            <p>
              Misty is an experimental distributed file system that started as an
              educational project and grew into a practical tool for managing files
              across devices.
            </p>
            <p>
              It combines a minimal gRPC-based DFS core with Tailscale-aware
              peer-to-peer networking, cloud storage integration, and a native
              cross-platform desktop client. The goal is simple: your files should be
              accessible wherever you are, without relying entirely on third-party
              cloud providers.
            </p>
            <p>
              The project is open source and actively developed. Contributions,
              feedback, and bug reports are welcome.
            </p>
          </div>
        </div>
      </AnimateIn>

      {/* Values */}
      <AnimateIn animation="fade-in">
        <div className="mb-20">
          <h2 className="text-2xl font-bold text-text mb-8">Core Principles</h2>
          <div className="grid md:grid-cols-3 gap-5">
            {values.map((item, i) => (
              <AnimateIn key={item.title} delay={i * 100} animation="fade-in-up">
                <GlowCard className="h-full">
                  <div className="p-7">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-5">
                      {item.icon}
                    </div>
                    <h3 className="text-base font-semibold text-text mb-2">{item.title}</h3>
                    <p className="text-sm text-text-muted leading-relaxed">{item.description}</p>
                  </div>
                </GlowCard>
              </AnimateIn>
            ))}
          </div>
        </div>
      </AnimateIn>

      {/* Tech Stack */}
      <AnimateIn animation="fade-in">
        <div>
          <h2 className="text-2xl font-bold text-text mb-8">Tech Stack</h2>
          <div className="flex flex-col gap-4">
            {stack.map((item, i) => (
              <AnimateIn key={item.layer} delay={i * 80} animation="fade-in-up">
                <GlowCard>
                  <div className="p-6 flex flex-col md:flex-row md:items-start gap-5">
                    <div className="md:w-52 shrink-0 flex items-start gap-3">
                      <div className={`w-1.5 h-10 rounded-full ${item.color} shrink-0`} />
                      <div>
                        <h3 className="text-text font-semibold text-sm">{item.layer}</h3>
                        <p className="text-xs text-primary font-mono mt-1">{item.tech}</p>
                      </div>
                    </div>
                    <p className="text-text-muted text-sm leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </GlowCard>
              </AnimateIn>
            ))}
          </div>
        </div>
      </AnimateIn>

      {/* GitHub CTA */}
      <AnimateIn delay={200} animation="fade-in-up">
        <div className="mt-20 text-center">
          <div className="glass-card rounded-2xl p-10 max-w-xl mx-auto">
            <h3 className="text-xl font-bold text-text mb-3">Contribute</h3>
            <p className="text-text-muted text-sm mb-6 leading-relaxed">
              Misty is open source and welcomes contributions of all kinds -- code,
              documentation, bug reports, and feature requests.
            </p>
            <a
              href="https://github.com/kannachi323/misty"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-text font-medium rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </AnimateIn>
    </div>
  );
}
