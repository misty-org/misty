import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installed: new Set<string>(),
  signedIn: new Map<string, boolean | null>(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("../../account/components/WelcomeNav", () => ({ WelcomeNav: () => null }));
vi.mock("@/native/invoke", () => ({
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
            // Shipped and checked when the catalog was built.
            {
              name: "Notion",
              description: "",
              url: "https://mcp.notion.com/mcp",
              app: "notion",
              icon: "",
              checked: true,
            },
            // Newer than the catalog: checked live, and it needs an app of Misty's, so it's hidden.
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
      default:
        throw new Error(`unexpected ${command}`);
    }
  }),
}));

import { useSetupStore } from "@/features/account";
import { resetCliStatusForTests } from "@/features/engine-config/clis/useCliVersionStatus";
import { engineSetupState } from "@/features/agents";
import { SetupPage } from "./SetupPage";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

/** Opens setup on its first step, How Misty works, and by default moves on to the engines. */
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
  // A CLI that can't say (Kimi, Grok, Qoder before Misty saw a sign-in finish) asks for one.
  expect(engineSetupState("kimi", { status: status({}), signIn: signIn(null), error: null })).toBe(
    "sign-in",
  );
  expect(engineSetupState("minimax", { status: status({}), signIn: null, error: null })).toBe(
    "sign-in",
  );
  expect(engineSetupState("kimi", { status: status({}), signIn: signIn(true), error: null })).toBe(
    "ready",
  );
  // OpenCode is free with no account, and DeepSeek Harness signs in in its own page.
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
  expect(screen.getAllByRole("listitem", { name: /^Step \d of 3$/ }).length).toBe(3);
  expect(screen.queryByRole("button", { name: "Install Claude Code" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "Pick an AI to start with" })).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Install Claude Code" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "How Misty works" })).toBeTruthy();
});

it("needs one ready engine to continue, and offers to skip without one", async () => {
  renderSetup();
  expect(await screen.findByRole("button", { name: "Install Claude Code" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
  expect(
    await screen.findByRole("heading", { name: "Which apps should agents use?" }),
  ).toBeTruthy();
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
  // Apps that sign in directly come first; one that needs a key of Misty's never shows.
  expect(await screen.findByRole("button", { name: "Connect Notion" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Connect Asana" })).toBeNull();
  // Composio needs a developer key, so it waits for the integrations settings.
  expect(screen.queryByRole("button", { name: /Composio/ })).toBeNull();
  expect(screen.queryByLabelText("Composio key")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Start using Misty" }));
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/agents"));
  expect(useSetupStore.getState().welcomed).toBe(true);
  expect(useSetupStore.getState().tabSidePending).toBe(true);
});
