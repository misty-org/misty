const stack = [
  {
    layer: "Desktop Client",
    tech: "C++20, ImGui, OpenGL 3.3, GLFW",
    description:
      "Cross-platform native application with a custom dark-themed UI. Handles file browsing, workspace management, and cloud service integration.",
  },
  {
    layer: "DFS Core",
    tech: "C++20, gRPC, Protobuf",
    description:
      "Minimal distributed file system with streaming I/O, file locking, and chunked transfers. Designed as an educational project with practical utility.",
  },
  {
    layer: "API Proxy",
    tech: "Go, chi, SQLite, gRPC",
    description:
      "Lightweight HTTP gateway that bridges REST clients to the gRPC backend. Manages authentication, devices, and workspaces.",
  },
  {
    layer: "Networking",
    tech: "Tailscale, WireGuard",
    description:
      "Secure mesh networking for peer-to-peer file sharing. No port forwarding or public exposure required.",
  },
  {
    layer: "Cloud Integration",
    tech: "OAuth2, OneDrive API, Google Drive API",
    description:
      "Mount cloud storage providers as virtual workspaces. Browse and manage cloud files alongside local storage.",
  },
];

export default function About() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      {/* Overview */}
      <div className="max-w-3xl mb-16">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-6">
          About Misty
        </h1>
        <div className="space-y-4 text-text-muted leading-relaxed">
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

      {/* Tech Stack */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-8">Tech Stack</h2>
        <div className="space-y-4">
          {stack.map((item) => (
            <div
              key={item.layer}
              className="bg-surface border border-border rounded-xl p-5 flex flex-col md:flex-row md:items-start gap-4"
            >
              <div className="md:w-48 shrink-0">
                <h3 className="text-white font-medium">{item.layer}</h3>
                <p className="text-xs text-primary mt-1">{item.tech}</p>
              </div>
              <p className="text-text-muted text-sm leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
