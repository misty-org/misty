import { useState } from "react";

interface DocSection {
  id: string;
  title: string;
  content: React.ReactNode;
}

const sections: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    content: (
      <>
        <h2 className="text-2xl font-bold text-white mb-4">Getting Started</h2>
        <p className="mb-4">
          Misty is a distributed file system built with C++20 and gRPC. Follow these
          steps to set up your first node.
        </p>
        <h3 className="text-lg font-medium text-white mt-6 mb-3">Prerequisites</h3>
        <ul className="list-disc list-inside space-y-2 text-text-muted">
          <li>CMake 3.16 or higher</li>
          <li>A C++20 compatible compiler (MSVC, Clang, GCC)</li>
          <li>vcpkg for dependency management</li>
          <li>Go 1.21+ (for the proxy service)</li>
          <li>Tailscale (optional, for P2P networking)</li>
        </ul>
        <h3 className="text-lg font-medium text-white mt-6 mb-3">Building from Source</h3>
        <pre className="bg-elevated border border-border rounded-lg p-4 overflow-x-auto text-sm mb-4">
          <code>{`git clone https://github.com/your-repo/misty.git
cd misty
cmake -B build -S app
cmake --build build --config Release`}</code>
        </pre>
        <h3 className="text-lg font-medium text-white mt-6 mb-3">Running the Proxy</h3>
        <pre className="bg-elevated border border-border rounded-lg p-4 overflow-x-auto text-sm">
          <code>{`cd proxy
go run .`}</code>
        </pre>
      </>
    ),
  },
  {
    id: "architecture",
    title: "Architecture",
    content: (
      <>
        <h2 className="text-2xl font-bold text-white mb-4">Architecture</h2>
        <p className="mb-4">
          Misty is composed of three main components that work together to provide
          a seamless distributed file experience.
        </p>
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-medium text-white mb-2">DFS Core (C++20)</h3>
            <p className="text-text-muted">
              The core distributed file system handles file storage, chunked streaming,
              and file locking via gRPC. It manages workspaces, virtual paths, and
              platform-specific file sync operations.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-medium text-white mb-2">API Proxy (Go)</h3>
            <p className="text-text-muted">
              A lightweight Go service built with chi that bridges HTTP REST requests
              to gRPC calls. Handles authentication, device management, and serves as
              the gateway for web and mobile clients. Uses SQLite for local state.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-medium text-white mb-2">Desktop Client (ImGui)</h3>
            <p className="text-text-muted">
              A cross-platform native client built with ImGui and OpenGL 3.3. Features
              a file explorer, workspace management, cloud service integration, and
              real-time notifications.
            </p>
          </div>
        </div>
      </>
    ),
  },
  {
    id: "api-reference",
    title: "API Reference",
    content: (
      <>
        <h2 className="text-2xl font-bold text-white mb-4">API Reference</h2>
        <p className="mb-6">
          The proxy exposes a REST API under the <code className="bg-elevated px-2 py-0.5 rounded text-primary text-sm">/api</code> prefix.
        </p>
        <div className="space-y-4">
          {[
            { method: "POST", path: "/api/register", desc: "Create a new user account" },
            { method: "POST", path: "/api/login", desc: "Authenticate and receive a token" },
            { method: "GET", path: "/api/devices", desc: "List registered devices" },
            { method: "POST", path: "/api/devices", desc: "Register a new device" },
            { method: "GET", path: "/api/workspaces", desc: "List all workspaces" },
            { method: "POST", path: "/api/workspaces", desc: "Create a new workspace" },
            { method: "GET", path: "/api/ts-status", desc: "Get Tailscale connection status" },
            { method: "GET", path: "/api/ts-peers", desc: "List Tailscale peers" },
          ].map((endpoint) => (
            <div
              key={endpoint.path + endpoint.method}
              className="flex items-start gap-3 bg-elevated border border-border rounded-lg p-4"
            >
              <span
                className={`text-xs font-mono font-bold px-2 py-1 rounded shrink-0 ${
                  endpoint.method === "GET"
                    ? "bg-success/15 text-success"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {endpoint.method}
              </span>
              <div>
                <code className="text-sm text-white">{endpoint.path}</code>
                <p className="text-text-muted text-sm mt-1">{endpoint.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </>
    ),
  },
  {
    id: "cloud-services",
    title: "Cloud Services",
    content: (
      <>
        <h2 className="text-2xl font-bold text-white mb-4">Cloud Services</h2>
        <p className="mb-6">
          Misty integrates with cloud storage providers, letting you mount them as
          virtual workspaces alongside your local files.
        </p>
        <div className="space-y-6">
          <div className="bg-elevated border border-border rounded-lg p-5">
            <h3 className="text-lg font-medium text-white mb-2">OneDrive</h3>
            <p className="text-text-muted mb-3">
              Connect your Microsoft OneDrive account to browse, upload, and download
              files. Authentication uses OAuth2 with Microsoft's identity platform.
            </p>
            <p className="text-sm text-text-muted">
              Navigate to <span className="text-primary">Services &rarr; OneDrive</span> in
              the desktop client to connect your account.
            </p>
          </div>
          <div className="bg-elevated border border-border rounded-lg p-5">
            <h3 className="text-lg font-medium text-white mb-2">Google Drive</h3>
            <p className="text-text-muted mb-3">
              Mount Google Drive as a workspace. Browse your files, upload new ones,
              and manage your storage directly from Misty.
            </p>
            <p className="text-sm text-text-muted">
              Navigate to <span className="text-primary">Services &rarr; Google Drive</span> in
              the desktop client to connect your account.
            </p>
          </div>
        </div>
      </>
    ),
  },
  {
    id: "tailscale",
    title: "Tailscale Setup",
    content: (
      <>
        <h2 className="text-2xl font-bold text-white mb-4">Tailscale Setup</h2>
        <p className="mb-4">
          Tailscale provides the secure mesh network that connects your Misty nodes
          together without exposing any ports to the public internet.
        </p>
        <h3 className="text-lg font-medium text-white mt-6 mb-3">Installation</h3>
        <ol className="list-decimal list-inside space-y-2 text-text-muted mb-4">
          <li>Install Tailscale on each device you want to connect</li>
          <li>Sign in with the same Tailscale account on all devices</li>
          <li>Verify connectivity with <code className="bg-elevated px-2 py-0.5 rounded text-primary text-sm">tailscale status</code></li>
        </ol>
        <h3 className="text-lg font-medium text-white mt-6 mb-3">Using with Misty</h3>
        <p className="text-text-muted mb-4">
          Once Tailscale is running, Misty automatically discovers peers on your
          tailnet. You can check the status and ping peers from the desktop client
          or via the API:
        </p>
        <pre className="bg-elevated border border-border rounded-lg p-4 overflow-x-auto text-sm">
          <code>{`GET /api/ts-status   # Connection status
GET /api/ts-peers    # List peers on your tailnet
POST /api/ts-ping    # Ping a specific peer`}</code>
        </pre>
      </>
    ),
  },
];

export default function Docs() {
  const [activeSection, setActiveSection] = useState(sections[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentSection = sections.find((s) => s.id === activeSection)!;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden mb-4 flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        Navigation
      </button>

      <div className="flex gap-10">
        {/* Sidebar */}
        <aside
          className={`shrink-0 w-56 ${
            sidebarOpen ? "block" : "hidden"
          } md:block`}
        >
          <nav className="sticky top-24 space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => {
                  setActiveSection(section.id);
                  setSidebarOpen(false);
                }}
                className={`block w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeSection === section.id
                    ? "text-primary bg-primary/10"
                    : "text-text-muted hover:text-text hover:bg-white/5"
                }`}
              >
                {section.title}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <article className="flex-1 min-w-0 text-text-muted leading-relaxed">
          {currentSection.content}
        </article>
      </div>
    </div>
  );
}
