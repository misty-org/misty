import { useState } from "react";

interface DocSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-bg border border-border rounded-xl p-4 overflow-x-auto text-sm font-mono">
      <code className="text-text-secondary">{children}</code>
    </pre>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-bold text-text mb-4">{children}</h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-base font-semibold text-text mt-8 mb-3">{children}</h3>
  );
}

const sections: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
      </svg>
    ),
    content: (
      <>
        <SectionHeading>Getting Started</SectionHeading>
        <p className="mb-6 text-text-muted leading-relaxed">
          Misty is a distributed file system built with C++20 and gRPC. Follow these
          steps to set up your first node.
        </p>

        <SubHeading>Prerequisites</SubHeading>
        <div className="flex flex-col gap-2 mb-6">
          {[
            "CMake 3.16 or higher",
            "A C++20 compatible compiler (MSVC, Clang, GCC)",
            "vcpkg for dependency management",
            "Go 1.21+ (for the proxy service)",
            "Tailscale (optional, for P2P networking)",
          ].map((item) => (
            <div key={item} className="flex items-center gap-3 text-text-muted text-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              {item}
            </div>
          ))}
        </div>

        <SubHeading>Building from Source</SubHeading>
        <CodeBlock>{`git clone https://github.com/kannachi323/misty.git
cd misty
cmake -B build -S app
cmake --build build --config Release`}</CodeBlock>

        <SubHeading>Running the Proxy</SubHeading>
        <CodeBlock>{`cd proxy
go run .`}</CodeBlock>
      </>
    ),
  },
  {
    id: "architecture",
    title: "Architecture",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
      </svg>
    ),
    content: (
      <>
        <SectionHeading>Architecture</SectionHeading>
        <p className="mb-8 text-text-muted leading-relaxed">
          Misty is composed of three main components that work together to provide
          a seamless distributed file experience.
        </p>
        <div className="flex flex-col gap-5">
          {[
            {
              name: "DFS Core (C++20)",
              desc: "The core distributed file system handles file storage, chunked streaming, and file locking via gRPC. It manages workspaces, virtual paths, and platform-specific file sync operations.",
              color: "bg-primary",
            },
            {
              name: "API Proxy (Go)",
              desc: "A lightweight Go service built with chi that bridges HTTP REST requests to gRPC calls. Handles authentication, device management, and serves as the gateway for web and mobile clients. Uses SQLite for local state.",
              color: "bg-success",
            },
            {
              name: "Desktop Client (ImGui)",
              desc: "A cross-platform native client built with ImGui and OpenGL 3.3. Features a file explorer, workspace management, cloud service integration, and real-time notifications.",
              color: "bg-text-muted",
            },
          ].map((item) => (
            <div
              key={item.name}
              className="bg-bg border border-border rounded-xl p-5 flex items-start gap-4"
            >
              <div className={`w-1.5 h-full min-h-[40px] rounded-full ${item.color} shrink-0 mt-0.5`} />
              <div>
                <h3 className="text-sm font-semibold text-text mb-1.5">{item.name}</h3>
                <p className="text-text-muted text-sm leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </>
    ),
  },
  {
    id: "api-reference",
    title: "API Reference",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
    content: (
      <>
        <SectionHeading>API Reference</SectionHeading>
        <p className="mb-6 text-text-muted leading-relaxed">
          The proxy exposes a REST API under the{" "}
          <code className="bg-bg px-2 py-0.5 rounded-md text-primary text-sm font-mono border border-border">/api</code>{" "}
          prefix.
        </p>
        <div className="flex flex-col gap-3">
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
              className="flex items-start gap-3 bg-bg border border-border rounded-xl p-4 transition-colors hover:border-border"
            >
              <span
                className={`text-xs font-mono font-semibold px-2.5 py-1 rounded-lg shrink-0 ${
                  endpoint.method === "GET"
                    ? "bg-success/10 text-success"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {endpoint.method}
              </span>
              <div>
                <code className="text-sm text-text font-mono">{endpoint.path}</code>
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
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
      </svg>
    ),
    content: (
      <>
        <SectionHeading>Cloud Services</SectionHeading>
        <p className="mb-8 text-text-muted leading-relaxed">
          Misty integrates with cloud storage providers, letting you mount them as
          virtual workspaces alongside your local files.
        </p>
        <div className="flex flex-col gap-5">
          {[
            {
              name: "OneDrive",
              desc: "Connect your Microsoft OneDrive account to browse, upload, and download files. Authentication uses OAuth2 with Microsoft's identity platform.",
              hint: "Services > OneDrive",
            },
            {
              name: "Google Drive",
              desc: "Mount Google Drive as a workspace. Browse your files, upload new ones, and manage your storage directly from Misty.",
              hint: "Services > Google Drive",
            },
          ].map((service) => (
            <div
              key={service.name}
              className="bg-bg border border-border rounded-xl p-6"
            >
              <h3 className="text-base font-semibold text-text mb-2">{service.name}</h3>
              <p className="text-text-muted text-sm leading-relaxed mb-3">{service.desc}</p>
              <p className="text-xs text-text-muted">
                Navigate to{" "}
                <span className="text-primary font-medium">{service.hint}</span>{" "}
                in the desktop client to connect your account.
              </p>
            </div>
          ))}
        </div>
      </>
    ),
  },
  {
    id: "tailscale",
    title: "Tailscale Setup",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
    content: (
      <>
        <SectionHeading>Tailscale Setup</SectionHeading>
        <p className="mb-6 text-text-muted leading-relaxed">
          Tailscale provides the secure mesh network that connects your Misty nodes
          together without exposing any ports to the public internet.
        </p>

        <SubHeading>Installation</SubHeading>
        <div className="flex flex-col gap-3 mb-6">
          {[
            "Install Tailscale on each device you want to connect",
            "Sign in with the same Tailscale account on all devices",
            "Verify connectivity with tailscale status",
          ].map((step, i) => (
            <div key={step} className="flex items-start gap-3 text-text-muted text-sm">
              <span className="w-6 h-6 rounded-lg bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              {step}
            </div>
          ))}
        </div>

        <SubHeading>Using with Misty</SubHeading>
        <p className="text-text-muted text-sm leading-relaxed mb-4">
          Once Tailscale is running, Misty automatically discovers peers on your
          tailnet. You can check the status and ping peers from the desktop client
          or via the API:
        </p>
        <CodeBlock>{`GET /api/ts-status   # Connection status
GET /api/ts-peers    # List peers on your tailnet
POST /api/ts-ping    # Ping a specific peer`}</CodeBlock>
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
        className="md:hidden mb-6 flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors px-3 py-2 rounded-lg border border-border bg-surface/50"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
        </svg>
        Navigation
      </button>

      <div className="flex gap-12">
        {/* Sidebar */}
        <aside
          className={`shrink-0 w-56 ${
            sidebarOpen ? "block" : "hidden"
          } md:block`}
        >
          <nav className="sticky top-24">
            <div className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 px-3">
              Documentation
            </div>
            <div className="flex flex-col gap-0.5">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => {
                    setActiveSection(section.id);
                    setSidebarOpen(false);
                  }}
                  className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    activeSection === section.id
                      ? "text-text bg-primary/10 border border-primary/20"
                      : "text-text-muted hover:text-text hover:bg-elevated border border-transparent"
                  }`}
                >
                  <span className={activeSection === section.id ? "text-primary" : ""}>
                    {section.icon}
                  </span>
                  {section.title}
                </button>
              ))}
            </div>
          </nav>
        </aside>

        {/* Content */}
        <article
          key={activeSection}
          className="flex-1 min-w-0 text-text-muted leading-relaxed animate-fade-in"
        >
          {currentSection.content}
        </article>
      </div>
    </div>
  );
}
