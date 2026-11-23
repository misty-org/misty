import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installed: new Set<string>(),
  signedIn: new Map<string, boolean | null>(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("../../account/components/WelcomeNav", () => ({ WelcomeNav: () => null }));
vi.mock("@/shared/platform/native_invoke", () => ({
  invoke: vi.fn(async (command: string, args?: { engine?: string }) => {
    const engine = args?.engine ?? "";
    switch (command) {
      case "engine_cli_status":
        return {
          engine,
          installed: mocks.installed.has(engine),
          localVersion: mocks.installed.has(engine) ? "1.0.0" : null,
          latestVersion: "1.0.0",
          updateAvailable: false,
          updateKind: "npm",
        };
      case "engine_cli_signed_in":
        return {
          engine,
          installed: mocks.installed.has(engine),
          signedIn: mocks.signedIn.get(engine) ?? null,
          detail: null,
        };
      case "direct_apps_catalog":
        return {
          total: 1,
          apps: [
            {
              name: "Notion",
              description: "",
              url: "https://mcp.notion.com/mcp",
              app: "notion",
              icon: "",
              checked: true,
            },
            {
              name: "Asana",
              description: "",
              url: "https://mcp.asana.com/v2/mcp",
              app: "asana",
              icon: "",
              checked: false,
            },
          ],
        };
      case "direct_apps_check":
        return {
          "https://mcp.notion.com/mcp": "keyless",
          "https://mcp.asana.com/v2/mcp": "needs_app",
        };
      case "direct_apps_list":
        return [];
      case "speech_catalog":
        return {
          hearing: [],
          voices: [
            {
              id: "amy",
              name: "Amy",
              maker: "",
              source: "",
              license: "MIT",
              languages: ["en"],
              package: { url: "", sha256: "", size: 0 },
              disk_mb: 60,
              memory_mb: 100,
              installed: false,
              outdated: false,
              packageKey: "amy",
              accent: "British English",
              gender: "female",
              family: "piper",
              speaker: 0,
            },
          ],
          supportInstalled: false,
          machine: { memoryMb: 16_000, cores: 8, appleSilicon: true, diskFreeMb: null },
          installing: [],
        };
      case "engines_list":
        return ["claude", "codex", "agy", "opencode"].map((id) => ({
          id,
          name: id,
          installed: mocks.installed.has(id),
          version: null,
          supportsImages: true,
          supportsMcp: true,
          supportsWebSearch: id !== "opencode" && id !== "agy",
          modes: [],
        }));
      default:
        throw new Error(`unexpected ${command}`);
    }
  }),
}));

import { useSetupStore } from "@/features/account";
import { resetCliStatusForTests } from "@/features/engine-config/clis/use_cli_version_status";
import { engineSetupState } from "@/features/agents";
import { SetupPage } from "./SetupPage";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderSetup({ pastIntro = true } = {}) {
  render(
    <MemoryRouter initialEntries={["/setup"]}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  if (pastIntro) fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

beforeEach(() => {
  resetCliStatusForTests();
  mocks.installed.clear();
  mocks.signedIn.clear();
  useSetupStore.setState({ welcomed: false, tabSidePending: false });
});
afterEach(cleanup);

it("asks for one next step per engine", () => {
  const installed = { localVersion: "1", latestVersion: "1", updateAvailable: false };
  const status = (more: object) => ({
    engine: "claude",
    installed: true,
    ...installed,
    updateKind: "npm" as const,
    ...more,
  });
  const signIn = (signedIn: boolean | null) => ({
    engine: "claude",
    installed: true,
    signedIn,
    detail: null,
  });
  expect(engineSetupState("claude", { status: null, signIn: null, error: null })).toBe("checking");
  expect(engineSetupState("claude", { status: null, signIn: null, error: "boom" })).toBe("failed");
  expect(
    engineSetupState("claude", { status: status({ installed: false }), signIn: null, error: null }),
  ).toBe("install");
  expect(
    engineSetupState("grok", {
      status: status({ installed: false, updateKind: null }),
      signIn: null,
      error: null,
    }),
  ).toBe("get");
  expect(
    engineSetupState("claude", { status: status({}), signIn: signIn(false), error: null }),
  ).toBe("sign-in");
  expect(engineSetupState("kimi", { status: status({}), signIn: signIn(null), error: null })).toBe(
    "sign-in",
  );
  expect(engineSetupState("minimax", { status: status({}), signIn: null, error: null })).toBe(
    "sign-in",
  );
  expect(engineSetupState("kimi", { status: status({}), signIn: signIn(true), error: null })).toBe(
    "ready",
  );
  expect(
    engineSetupState("opencode", { status: status({}), signIn: signIn(null), error: null }),
  ).toBe("ready");
  expect(engineSetupState("dsh", { status: status({}), signIn: signIn(false), error: null })).toBe(
    "ready",
  );
});

it("explains how Misty works before the engines, and comes back to it", async () => {
  renderSetup({ pastIntro: false });
  expect(screen.getByRole("heading", { name: "How Misty works" })).toBeTruthy();
  expect(screen.getByText(/doesn't control how it behaves/)).toBeTruthy();
  expect(screen.getByText(/An AI does the work/)).toBeTruthy();
  expect(screen.getAllByRole("listitem", { name: /^Step \d of 4$/ }).length).toBe(4);
  expect(screen.queryByRole("button", { name: "Install Claude Code" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "Pick your default engine" })).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Install Claude Code" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "How Misty works" })).toBeTruthy();
});

it("needs a ready engine that can run Misty to continue, with no way to skip", async () => {
  renderSetup();
  expect(await screen.findByRole("button", { name: "Install Claude Code" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
});

it("doesn't count a ready engine that can't run Misty's own work", async () => {
  mocks.installed.add("opencode");
  renderSetup();
  expect(await screen.findByText("Can't run Misty's own work")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
});

it("picks the first capable engine as the default, and lets another be chosen", async () => {
  mocks.installed.add("claude").add("codex");
  mocks.signedIn.set("claude", true).set("codex", true);
  renderSetup();
  const claude = await screen.findByRole("radio", { name: /claude/i });
  await waitFor(() => expect(claude.getAttribute("aria-checked")).toBe("true"));
  const codex = screen.getByRole("radio", { name: /codex/i });
  expect(codex.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(codex);
  await waitFor(() => expect(codex.getAttribute("aria-checked")).toBe("true"));
  expect(claude.getAttribute("aria-checked")).toBe("false");
});

it("opens on the engines alone for someone sent back to pick a default engine", async () => {
  mocks.installed.add("claude");
  mocks.signedIn.set("claude", true);
  render(
    <MemoryRouter initialEntries={[{ pathname: "/setup", state: { engineOnly: true } }]}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Pick your default engine" })).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/agents"));
  expect(screen.queryByRole("heading", { name: "Which apps should agents use?" })).toBeNull();
});

it("shows a signed-out engine's sign-in, and a signed-in one as ready", async () => {
  mocks.installed.add("claude").add("codex");
  mocks.signedIn.set("claude", true).set("codex", false);
  renderSetup();
  expect(await screen.findByRole("button", { name: "Sign in to Codex" })).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false),
  );
  expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
});

it("offers only the direct sign-ins, which need no key, then ends the welcome", async () => {
  mocks.installed.add("claude");
  mocks.signedIn.set("claude", true);
  renderSetup();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "Pick Misty's voice" })).toBeTruthy();
  const amy = await screen.findByRole("button", { name: "Amy (British English)" });
  expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(amy);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("button", { name: "Connect Notion" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Connect Asana" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Start using Misty" }));
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/agents"));
  expect(useSetupStore.getState().welcomed).toBe(true);
  expect(useSetupStore.getState().tabSidePending).toBe(true);
});
