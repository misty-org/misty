import { Section } from "./data";

export const guideSections: Section[] = [
  {
    id: "introduction",
    label: "Overview",
    category: "getting-started",
    title: "What is Misty?",
    prose: [
      "Misty is a desktop file manager that unifies all your cloud storage providers into a single window. Instead of switching between Google Drive, OneDrive, and Dropbox in separate browser tabs, you browse, move, and organize everything in one place.",
      "Misty runs entirely on your machine. There's no cloud relay, no third-party server in the middle. Your credentials and file data never leave your device.",
      "The app is built with a C++ ImGui frontend and a Go backend that communicate over gRPC. This gives you a fast, native UI with the flexibility and reliability of Go for all the cloud provider integrations.",
    ],
    notes: [
      { kind: "tip", text: "Misty is open source. You can inspect the code, build from source, or contribute on GitHub." },
      { kind: "note", text: "Misty supports Windows 10+, macOS 12+, and Linux (x86_64 and ARM64)." },
    ],
  },
  {
    id: "installation",
    label: "Installation",
    category: "getting-started",
    title: "Installation",
    prose: [
      "Download the latest release for your platform from the download page. Misty is available for Windows, macOS, and Linux.",
      "Windows — Run the installer (.exe) and follow the prompts. Misty will be added to your Start menu and can optionally start on login.",
      "macOS — Open the .dmg, drag Misty to Applications, and launch it. On first run you may need to allow it in System Settings > Privacy & Security.",
      "Linux — Download the .AppImage or .deb package. For AppImage, make it executable (chmod +x) and run it. For Debian-based distros, install with dpkg -i.",
      "After installation, launch Misty and create an account. The local proxy service starts automatically in the background — no manual configuration needed.",
    ],
    notes: [
      { kind: "tip", text: "Misty auto-updates by default. You can disable this in Settings if you prefer to update manually." },
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
    id: "quick-start",
    label: "Quick Start",
    category: "getting-started",
    title: "Quick Start",
    prose: [
      "1. Download & install — Grab Misty for your platform from the download page and create an account.",
      "2. Connect providers — Link your Google Drive, OneDrive, or Dropbox accounts through the app's settings. Misty uses OAuth so you never enter your cloud password directly.",
      "3. Browse & manage — View all your cloud files in one place. Move, copy, and organize across providers using the Misty clipboard.",
      "4. Transfer files — Drag and drop files between providers, or use the clipboard to queue up cross-provider transfers that run in the background.",
    ],
    notes: [
      { kind: "tip", text: "You can connect multiple accounts from the same provider — for example, a personal and a work Google Drive." },
      { kind: "note", text: "Some features like unlimited accounts and the Misty clipboard require a Pro or Max plan. Check the pricing page for details." },
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
