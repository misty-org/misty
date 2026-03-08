import { Section, Category } from "./data";

export const guideSections: Section[] = [
  {
    id: "introduction",
    label: "Introduction",
    category: "guide",
    title: "Introduction",
    prose: [
      "Misty runs a lightweight local service on your machine that connects to your cloud storage providers. All requests to Google Drive, OneDrive, and Dropbox are proxied through this local service — meaning your credentials and file data stay on your device and are never routed through a third-party server.",
      "The Misty desktop app communicates with this local service automatically. You don't need to configure ports or manage any networking — just launch Misty and it handles the rest.",
      "Under the hood, Misty uses OAuth 2.0 to authenticate with each cloud provider. Tokens are stored locally and refreshed automatically. The local proxy translates a unified REST API into provider-specific calls, so you get one consistent interface for all your files.",
    ],
    notes: [
      { kind: "tip", text: "Misty never sends your credentials or file data to any external server. Everything stays on your machine." },
      { kind: "note", text: "Misty requires an internet connection to communicate with cloud providers, but the proxy itself runs entirely on localhost." },
    ],
  },
  {
    id: "quick-start",
    label: "Quick Start",
    category: "guide",
    title: "Quick Start",
    prose: [
      "1. Download & install — Grab Misty for your platform from the download page and create an account.",
      "2. Connect providers — Link your Google Drive, OneDrive, or Dropbox accounts through the app's settings.",
      "3. Browse & manage — View all your cloud files in one place. Move, copy, and organize across providers.",
    ],
    notes: [
      { kind: "tip", text: "You can connect multiple accounts from the same provider — for example, a personal and a work Google Drive." },
      { kind: "note", text: "Some features like cloud storage integrations require a Pro plan. Check the pricing page for details." },
    ],
  },
];
