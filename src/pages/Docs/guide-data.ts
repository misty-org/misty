import { Section } from "./data";

export const guideSections: Section[] = [
  {
    id: "introduction",
    label: "Overview",
    category: "getting-started",
    title: "What is Misty?",
    prose: [
      "Misty is a desktop file manager that brings your cloud storage — Google Drive, OneDrive, Dropbox, Amazon S3, and SFTP — into a single native window. Instead of juggling browser tabs and separate apps, you browse, move, and manage everything from one place.",
      "At its core is a local Go proxy that runs on your machine and talks directly to cloud provider APIs. There is no Misty relay server. Your credentials and file data never leave your device — OAuth tokens are stored locally and refreshed automatically.",
      "Beyond file management, Misty ships with a plugin system for extending the UI with custom workflows, restic-powered encrypted backups (Vault), a Gemini-powered AI assistant that understands your files, Tailscale integration for secure remote access, and a CLI for working from the terminal.",
      "The desktop client is built with C++ and ImGui for a fast, native UI. The local proxy communicates with the client over HTTP on localhost. Everything runs on your machine — there is no Misty cloud service.",
    ],
    notes: [
      { kind: "note", text: "Misty supports Windows 10+, macOS 12+, and Linux (x86_64 and ARM64)." },
      { kind: "tip", text: "Misty is open source. You can inspect the code, build from source, or contribute on GitHub." },
    ],
  },
  {
    id: "installation",
    label: "Installation",
    category: "getting-started",
    title: "Installation",
    prose: [
      "Getting started takes a few minutes. Download Misty, install it, create a free account, and connect your first cloud provider.",
    ],
    steps: [
      {
        heading: "Download Misty",
        text: "Head to the download page and grab the latest release for your platform. Misty is available for Windows, macOS, and Linux.",
      },
      {
        heading: "Install",
        text: "Windows — Run the .exe installer and follow the prompts. Misty is added to your Start menu and can optionally launch on startup. macOS — Open the .dmg and drag Misty to Applications. On first run, allow it in System Settings › Privacy & Security. Linux — Download the .AppImage or .deb. For AppImage, mark it executable (chmod +x) and run it. For .deb, install with dpkg -i misty.deb.",
      },
      {
        heading: "Launch Misty",
        text: "Open Misty. The local proxy starts automatically in the background — no configuration needed. On first launch you'll be taken to the sign-in screen.",
        screenshot: null,
      },
      {
        heading: "Create an account",
        text: "Register with your email and a password. Misty creates a local user profile tied to your machine. No payment is required for a free account.",
        screenshot: null,
      },
      {
        heading: "Connect your first provider",
        text: "Open Settings and click Add Provider. Choose Google Drive, OneDrive, Dropbox, S3, or SFTP. Misty opens your browser for the OAuth flow — you authorize access directly with the provider. Your credentials are stored locally and never sent to Misty's servers.",
        screenshot: "/misty-connect.png",
      },
      {
        heading: "Browse your files",
        text: "Once connected, your provider appears in the sidebar. Browse, upload, download, move, and organize files across all your connected providers from a single window.",
        screenshot: "/misty-browse.png",
      },
    ],
    notes: [
      { kind: "tip", text: "Misty auto-updates by default. You can disable this in Settings if you prefer to update manually." },
      { kind: "tip", text: "You can connect multiple accounts from the same provider — for example, a personal and a work Google Drive." },
    ],
  },
  {
    id: "architecture",
    label: "Architecture",
    category: "architecture",
    title: "Architecture & Local Proxy",
    prose: [
      "Misty's architecture is built around a local proxy that runs on your machine. This proxy is the core of how Misty works — it sits between the desktop UI and your cloud providers, handling all authentication, API translation, and file transfers.",
      "The proxy is a Go service that exposes a unified REST API on localhost. When you browse files in the UI, the frontend makes gRPC calls to the proxy, which translates them into provider-specific API requests (Google Drive API, Microsoft Graph API, Dropbox API, etc.).",
      "OAuth 2.0 tokens are stored locally and refreshed automatically. The proxy detects token expiry on each request and handles renewal transparently — you never need to manually re-authenticate unless you revoke access from the provider's side.",
      "File transfers are streamed through the proxy using gRPC streaming. Large files are handled in chunks rather than loaded into memory, so there's no practical file size limit. The bottleneck is your internet connection, not Misty.",
      "Because everything runs locally, your data never passes through Misty's servers. There is no Misty cloud service. The proxy communicates directly with cloud provider APIs from your machine.",
    ],
    notes: [
      { kind: "note", text: "The proxy requires an internet connection to reach cloud provider APIs, but it runs entirely on localhost. It does not need to be publicly accessible." },
      { kind: "tip", text: "Advanced users can self-host the proxy on a separate machine (a homelab server, VPS, or NAS) and connect to it remotely. See the API Reference for details." },
    ],
  },
  {
    id: "extensions",
    label: "Extensions",
    category: "extensions",
    title: "Building Extensions",
    prose: [
      "Misty's local API gives you a single, unified interface to Google Drive, OneDrive, and Dropbox. Instead of wrangling three different SDKs and auth flows, you hit one localhost endpoint and Misty handles the rest. This makes it a powerful foundation for building your own tools.",
      "Automation — Write scripts that back up cloud files on a schedule, sync folders across providers, or trigger actions when files change. A simple cron job and curl is all you need.",
      "Developer tools — Build CLI clients, editor plugins (VS Code, Neovim), or TUI file browsers that let you work with cloud files without leaving your workflow.",
      "App integrations — Connect Misty to note-taking apps, media servers, CI/CD pipelines, or any tool that can make HTTP requests. Upload build artifacts, index cloud-stored photos, or sync notes across providers.",
      "Custom dashboards — Use the device, workspace, and Tailscale APIs to build monitoring dashboards, storage usage trackers, or network status panels.",
    ],
    notes: [
      { kind: "tip", text: "The API is the same one the Misty desktop app uses. If you can do it in the app, you can automate it with the API." },
      { kind: "note", text: "Extensions run locally against your proxy. There's no app store or review process — just build and use." },
    ],
  },
  {
    id: "cli",
    label: "CLI",
    category: "extensions",
    title: "Command-Line Interface",
    prose: [
      "Misty includes a CLI that wraps the local proxy API, letting you manage cloud files directly from your terminal. It's installed alongside the desktop app.",
      "misty ls — List files in a directory across any connected provider. Supports filtering by provider, file type, and size.",
      "misty cp / misty mv — Copy or move files between providers. Works like standard Unix commands but across cloud storage. Example: misty cp gdrive:/Photos/vacation.jpg onedrive:/Backup/",
      "misty upload / misty download — Transfer files between your local filesystem and any cloud provider. Supports glob patterns for batch operations.",
      "misty providers — List connected cloud accounts and their status. Quickly check which providers are authenticated and how much storage is used.",
      "misty config — Manage CLI settings like default provider, output format (table, JSON), and proxy connection details.",
    ],
    notes: [
      { kind: "tip", text: "Pipe misty ls output to other tools: misty ls gdrive:/ --json | jq '.[] | select(.size > 1000000)' to find large files." },
      { kind: "note", text: "The CLI requires the Misty proxy to be running. If you're using the desktop app, it's already running. For self-hosted setups, point the CLI to your proxy with misty config set proxy-url." },
    ],
  },
];
