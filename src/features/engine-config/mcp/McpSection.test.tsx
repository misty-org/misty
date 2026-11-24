// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfigEntry, McpEngineInventory, McpInventory, McpRuntimeSection } from "./types";

const api = vi.hoisted(() => ({
  inventory: vi.fn(),
  setEnabled: vi.fn(),
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

import { engineConfigHost } from "../host";

import { setCachedResource } from "@/api/cache/cached_resource";
import { useMcpProbeStore } from "./probe_store";
import { McpSection } from "./McpSection";
import { mcpInventoryKey } from "./use_mcp_inventory";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  api.probe.mockReset();
  api.inventory.mockResolvedValue(payload());
  api.setEnabled.mockResolvedValue(claudeProject());
  api.probe.mockResolvedValue(connectedProbe());
  useMcpProbeStore.setState({ results: {}, pending: {}, runningAll: false, error: null });
  setCachedResource(mcpInventoryKey("/ws"), null);
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

describe("McpSection", () => {
  it("reads the chosen folder's config and keeps config and runtime apart", async () => {
    await renderSection();
    expect(api.inventory).toHaveBeenCalledWith("/ws");
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).toContain("beta");
    expect(document.body.textContent).toContain("At runtime");
    expect(document.body.textContent).toContain("No session is running");
  });

  it("offers no switch for a read-only entry, and says why in its details", async () => {
    await renderSection();
    expect(row("alpha")?.textContent).toContain("On");
    expect(
      [...(row("alpha")?.querySelectorAll("button") ?? [])].some((button) =>
        button.textContent?.includes("Turn"),
      ),
    ).toBe(false);
    const open = document.querySelector<HTMLButtonElement>('button[aria-label="alpha, details"]');
    await act(async () => open?.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Read-only here");
    expect(dialog?.textContent).not.toContain("Turn off");
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
    const open = document.querySelector<HTMLButtonElement>('button[aria-label="alpha, details"]');
    await act(async () => open?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Choose a folder");
  });

  it("turns on a writable entry from its shelf item, with the version it read", async () => {
    await renderSection();
    const turnOn = [...(row("beta")?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Turn on",
    );
    expect(turnOn).toBeDefined();
    await act(async () => turnOn?.click());
    expect(api.setEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "claude_project:beta", version: "v2" }),
      true,
      "/ws",
    );
  });

  it("filters by the search text it is given", async () => {
    await act(async () => {
      root.render(<McpSection query="bet" />);
    });
    expect(document.body.textContent).toContain("beta");
    expect(document.body.textContent).not.toContain("alpha");
  });

  it("checks on open, reuses fresh results, and checks again only on request", async () => {
    api.probe.mockResolvedValue(connectedProbe(["a", "b"]));
    await renderSection();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Connected with 2 tools"));
    expect(api.probe.mock.calls.map((call) => call[0].name)).toEqual(["alpha"]);

    act(() => root.unmount());
    root = createRoot(container);
    api.probe.mockClear();
    await renderSection();
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.probe).not.toHaveBeenCalled();

    await act(async () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Check all"]')!.click(),
    );
    await vi.waitFor(() => {
      expect(api.probe).toHaveBeenCalledTimes(1);
      expect(api.probe.mock.calls[0][0].name).toBe("alpha");
    });
  });

  it("never checks on its own an entry whose config came with the folder", async () => {
    const gamma: McpConfigEntry = { ...claudeUser(), id: "claude_user:gamma", name: "gamma" };
    api.inventory.mockResolvedValue(
      payload({
        engines: [
          engine("claude", {
            config: {
              entries: [{ ...claudeProject(), enabled: true }, gamma],
              errors: [],
            },
          }),
        ],
      }),
    );
    await renderSection();
    await vi.waitFor(() => expect(api.probe).toHaveBeenCalled());
    expect(api.probe.mock.calls.map((call) => call[0].name)).toEqual(["gamma"]);
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
    const chip = () => row("alpha")?.querySelector<HTMLElement>('span[tabindex="0"]');
    await vi.waitFor(
      async () => {
        await act(async () => {
          chip()?.blur();
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
          chip()?.focus();
          await new Promise((resolve) => setTimeout(resolve, 100));
        });
        expect(
          document.querySelector('[data-slot="tooltip-content"]')?.textContent ?? "",
        ).toContain("Couldn't start it");
      },
      { timeout: 3000 },
    );
    await act(async () => {
      chip()?.blur();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  });

  it("lists the files it reads when an engine has nothing configured", async () => {
    api.inventory.mockResolvedValue(payload({ engines: [payload().engines[2]] }));
    await renderSection();
    expect(document.body.textContent).toContain("Files read");
    expect(document.body.textContent).toContain("/home/u/.kimi-code/mcp.json");
    expect(document.body.textContent).toContain("Not created yet");
  });

  it("explains an engine without MCP instead of an empty list", async () => {
    api.inventory.mockResolvedValue(
      payload({ engines: [engine("agy", { available: false, support: "none" })] }),
    );
    await renderSection();
    expect(document.body.textContent).toContain("Antigravity has no MCP of its own");
    expect(document.body.textContent).not.toContain("Added");
  });
});
