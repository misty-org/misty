import { desktopPages } from "./desktop";
import { referencePages } from "./reference";
import { releasePages } from "./release";
import { serverPages } from "./server";
import { startPages } from "./start";
import type { NavGroup } from "./types";
import { workspacePages } from "./workspace";

export const pages = [
  ...startPages,
  ...workspacePages,
  ...desktopPages,
  ...serverPages,
  ...releasePages,
  ...referencePages,
];

export const navGroups: NavGroup[] = [
  {
    title: "Start",
    items: [
      { label: "Overview", path: "/" },
      { label: "Getting started", path: "/getting-started" },
      { label: "Daily workflow", path: "/daily-workflow" },
      { label: "Global options", path: "/command-line" },
    ],
  },
  {
    title: "Workspace",
    items: [
      { label: "configure", path: "/configure", command: true },
      { label: "Configuration & environment", path: "/configuration" },
      { label: "doctor", path: "/doctor", command: true },
      { label: "check", path: "/check", command: true },
    ],
  },
  {
    title: "Desktop",
    items: [
      { label: "Overview", path: "/desktop" },
      { label: "desktop dev", path: "/desktop/dev", command: true },
      { label: "desktop build", path: "/desktop/build", command: true },
      { label: "desktop clean", path: "/desktop/clean", command: true },
      { label: "icons sync", path: "/desktop/icons", command: true },
      {
        label: "windows stage-assets",
        path: "/desktop/windows",
        command: true,
      },
    ],
  },
  {
    title: "Server",
    items: [
      { label: "Overview", path: "/server" },
      { label: "server up", path: "/server/up", command: true },
      { label: "server down", path: "/server/down", command: true },
      { label: "server logs", path: "/server/logs", command: true },
      { label: "image build", path: "/server/image", command: true },
      {
        label: "worker generate-secrets",
        path: "/server/worker",
        command: true,
      },
      { label: "r2 configure-cors", path: "/server/r2", command: true },
    ],
  },
  {
    title: "Releases",
    items: [
      { label: "Release workflow", path: "/releases" },
      { label: "release start", path: "/releases/start", command: true },
      { label: "release build", path: "/releases/build", command: true },
      { label: "release upload", path: "/releases/upload", command: true },
      { label: "release verify", path: "/releases/verify", command: true },
      { label: "release publish", path: "/releases/publish", command: true },
    ],
  },
  {
    title: "Reference",
    items: [
      { label: "Command index", path: "/reference/command-index" },
      { label: "Environment variables", path: "/reference/environment" },
      { label: "Safety model", path: "/reference/safety" },
      { label: "Troubleshooting", path: "/reference/troubleshooting" },
    ],
  },
];
