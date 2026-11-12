// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfigEntry, McpEngineInventory, McpInventory, McpRuntimeSection } from "./types";

const api = vi.hoisted(() => ({
  inventory: vi.fn(),
  setEnabled: vi.fn(),
  setLaunchMode: vi.fn(),
  probe: vi.fn(),
}));

vi.mock("./api", () => ({
  McpHubError: class McpHubError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  mcpApi: api,
}));

vi.mock("../EngineMark", () => ({ EngineMark: () => null, hasEngineMark: () => false }));

import { engineConfigHost } from "../host";

/** The tooltip an icon button shows on focus: its hint, which says why a switch is inert. */
async function hintOf(button: HTMLElement | null | undefined) {
  // Let the section settle first: a render while the tooltip opens would close it again.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  // A later render may have replaced the button found before it.
  const label = button?.getAttribute("aria-label");
  const live = button?.isConnected
    ? button
    : document.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
  await act(async () => {
    // Blurred first, so a button that already has focus gets the focus that opens its tooltip.
    live?.blur();
    live?.focus();
    await new Promise((resolve) => setTimeout(resolve, 800));
  });
  const text = document.querySelector('[data-slot="tooltip-content"]')?.textContent ?? "";
  // Closed again, so no test starts with a tooltip left open.
  await act(async () => {
    live?.blur();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  return text;
}
import { useMcpProbeStore } from "./probe-store";
import { McpSection } from "./McpSection";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The Space's linked folders: one folder, chosen.
engineConfigHost.provide({
  useLinkedFolders: () => ({ folders: ["/ws"], picked: "/ws" }),
  Markdown: ({ children }) => children,
  watchRunEvents: () => () => undefined,
});
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function claudeUser(): McpConfigEntry {
  return {
    id: "claude_user:alpha",
    engine: "claude",
    name: "alpha",
    source: "claude_user",
    scope: "user",
    workspaceFile: false,
    path: "/home/u/.claude.json",
    format: "json",
    enabled: true,
    transport: "stdio",
    command: "npx",
    argsCount: 2,
    url: null,
    envKeys: ["API_KEY"],
    headerKeys: [],
    writable: false,
    readonlyReason: "Read-only here",
    version: "v1",
  };
}

function claudeProject(): McpConfigEntry {
  return {
    id: "claude_project:beta",
    engine: "claude",
    name: "beta",
    source: "claude_project",
    scope: "project",
    workspaceFile: true,
    path: "/ws/.mcp.json",
    format: "json",
    enabled: false,
    transport: "http",
    command: null,
    argsCount: 0,
    url: "https://example.com/mcp?token=***",
    envKeys: [],
    headerKeys: ["Authorization"],
    writable: true,
    readonlyReason: null,
    version: "v2",
  };
}

function connectedProbe(tools = ["a"], toolCount = tools.length) {
  return {
    status: "connected" as const,
    message: null,
    tools,
    toolCount,
    serverName: "fake",
    protocolVersion: "2025-06-18",
    elapsedMs: 7,
  };
}

function noSession(): McpRuntimeSection {
  return {
    status: "no_session",
    reason: null,
    workspace: "/ws",
    sessionId: null,
    collectedAt: null,
    entries: [],
  };
}

/** One engine partition; defaults to a plain native engine with no config. */
function engine(
  id: McpEngineInventory["id"],
  overrides: Partial<McpEngineInventory> = {},
): McpEngineInventory {
  return {
    id,
    available: true,
    support: "native",
    sources: [],
    config: { entries: [], errors: [] },
    runtime: noSession(),
    ...overrides,
  };
}

function payload(overrides: Partial<McpInventory> = {}): McpInventory {
  return {
    engines: [
      engine("claude", {
        config: { entries: [claudeUser(), claudeProject()], errors: [] },
      }),
      engine("codex", {
        available: false,
        sources: [{ source: "codex_user", path: "/home/u/.codex/config.toml", exists: true }],
        config: {
          entries: [
            {
              ...claudeProject(),
              id: "codex_user:gamma",
              engine: "codex",
              name: "gamma",
              source: "codex_user",
              path: "/home/u/.codex/config.toml",
              format: "toml",
              enabled: true,
              writable: true,
              readonlyReason: null,
            },
          ],
          errors: [],
        },
        runtime: {
          status: "unsupported",
          reason: null,
          workspace: null,
          sessionId: null,
          collectedAt: null,
          entries: [],
        },
      }),
      engine("kimi", {
        sources: [
          {
            source: "kimi_user",
            path: "/home/u/.kimi-code/mcp.json",
            exists: false,
          },
          {
            source: "kimi_local",
            path: "/ws/.kimi-code/mcp.json",
            exists: false,
          },
        ],
      }),
      engine("pi", { available: false, support: "none" }),
    ],
    collectedAt: 1,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  api.inventory.mockReset();
  api.setEnabled.mockReset();
  api.setLaunchMode.mockReset();
  api.probe.mockReset();
  api.inventory.mockResolvedValue(payload());
  api.setEnabled.mockResolvedValue(claudeProject());
  api.setLaunchMode.mockResolvedValue(undefined);
  api.probe.mockResolvedValue(connectedProbe());
  useMcpProbeStore.setState({ results: {}, pending: {}, runningAll: false, error: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderSection() {
  await act(async () => {
    root.render(<McpSection />);
  });
}

function row(name: string): HTMLLIElement | undefined {
  return [...document.querySelectorAll("li")].find((item) => item.textContent?.includes(name));
}

function buttonExact(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

describe("McpSection", () => {
  it("reads the chosen folder's config and keeps config and runtime apart", async () => {
    await renderSection();
    expect(api.inventory).toHaveBeenCalledWith("/ws");
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).toContain("beta");
    // The runtime section says why it's empty instead of claiming there are no servers.
    expect(document.body.textContent).toContain("At runtime");
    expect(document.body.textContent).toContain("No session is running");
  });

  it("keeps a read-only entry's switch inert, with its reason", async () => {
    await renderSection();
    const toggle = row("alpha")?.querySelector<HTMLButtonElement>(
      'button[aria-label="Enable alpha"]',
    );
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.getAttribute("aria-disabled")).toBe("true");
    expect(await hintOf(toggle)).toContain("Read-only here");
    await act(async () => toggle?.click());
    expect(api.setEnabled).not.toHaveBeenCalled();
  });

  it("says why a Claude switch is inert without a folder", async () => {
    api.inventory.mockResolvedValue(
      payload({
        engines: [
          engine("claude", {
            config: {
              entries: [
                { ...claudeUser(), readonlyReason: null, readonlyReasonCode: "needs_workspace" },
              ],
              errors: [],
            },
          }),
        ],
      }),
    );
    await renderSection();
    // The switch's hover says why; so do the entry's details, which this reads.
    const open = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Details for alpha"]',
    );
    await act(async () => open?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Choose a folder");
  });

  it("toggles a writable entry from its row, with the version it read", async () => {
    await renderSection();
    const toggle = row("beta")?.querySelector<HTMLButtonElement>(
      'button[aria-label="Enable beta"]',
    );
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(toggle?.textContent).toBe("");
    await act(async () => toggle?.click());
    expect(api.setEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "claude_project:beta", version: "v2" }),
      true,
      "/ws",
    );
  });

  it("filters to the runtime list", async () => {
    await renderSection();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="radio"][value="runtime"]')?.click();
    });
    expect(document.body.textContent).not.toContain("alpha");
    expect(document.body.textContent).toContain("At runtime");
  });

  it("checks on open, reuses fresh results, and checks again only on request", async () => {
    api.probe.mockResolvedValue(connectedProbe(["a", "b"]));
    await renderSection();
    // Only the current engine's entries that are on and checkable (beta is off in the fixture).
    await vi.waitFor(() => expect(document.body.textContent).toContain("Connected · 2 tools"));
    expect(api.probe.mock.calls.map((call) => call[0].name)).toEqual(["alpha"]);

    // Mount again (opening quickly again): fresh results are reused and nothing starts.
    act(() => root.unmount());
    root = createRoot(container);
    api.probe.mockClear();
    await renderSection();
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.probe).not.toHaveBeenCalled();

    // Check all forces a new run (still only for entries that are on).
    await act(async () => buttonExact("Check all").click());
    await vi.waitFor(() => {
      expect(api.probe).toHaveBeenCalledTimes(1);
      expect(api.probe.mock.calls[0][0].name).toBe("alpha");
    });
  });

  it("never checks on its own an on-demand entry or one whose config came with the folder", async () => {
    const gamma: McpConfigEntry = { ...claudeUser(), id: "claude_user:gamma", name: "gamma" };
    api.inventory.mockResolvedValue(
      payload({
        engines: [
          engine("claude", {
            config: {
              entries: [
                { ...claudeUser(), launchMode: "onDemand" },
                { ...claudeProject(), enabled: true },
                gamma,
              ],
              errors: [],
            },
          }),
        ],
      }),
    );
    await renderSection();
    await vi.waitFor(() => expect(api.probe).toHaveBeenCalled());
    expect(api.probe.mock.calls.map((call) => call[0].name)).toEqual(["gamma"]);
    const launch = row("alpha")?.querySelector('button[aria-label="Start alpha on demand"]');
    expect(launch?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a failed check on the row, with the reason on hover", async () => {
    api.probe.mockResolvedValue({
      status: "failed",
      message: "Couldn't start it: No such file or directory",
      tools: [],
      toolCount: 0,
      serverName: null,
      protocolVersion: null,
      elapsedMs: 3,
    });
    await renderSection();
    await vi.waitFor(() => expect(row("alpha")?.textContent).toContain("Failed"));
    expect(row("alpha")?.querySelector('[title*="Couldn\'t start it"]')).toBeTruthy();
  });

  it("lists the files it reads when an engine has nothing configured", async () => {
    api.inventory.mockResolvedValue(payload({ engines: [payload().engines[2]] }));
    await renderSection();
    expect(document.body.textContent).toContain("Files read");
    expect(document.body.textContent).toContain("/home/u/.kimi-code/mcp.json");
    expect(document.body.textContent).toContain("Not created yet");
  });

  it("explains an engine without MCP instead of an empty list", async () => {
    api.inventory.mockResolvedValue(payload({ engines: [payload().engines[3]] }));
    await renderSection();
    expect(document.body.textContent).toContain("Pi has no MCP of its own");
    expect(document.body.textContent).not.toContain("Configured");
  });
});
