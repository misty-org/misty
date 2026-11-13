// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stored: new Map<string, unknown>(),
  open: vi.fn(async () => {}),
  write: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  show: vi.fn(),
}));

vi.mock("../folders/deviceState", () => ({
  readDeviceState: async (scope: string) => mocks.stored.get(scope) ?? null,
  updateDeviceState: async (
    scope: string,
    seed: () => unknown,
    change: (state: unknown) => unknown,
  ) => {
    const next = change(mocks.stored.get(scope) ?? seed());
    mocks.stored.set(scope, next);
    return next;
  },
}));
vi.mock("../terminal/terminalApi", () => ({
  terminalApi: { open: mocks.open, write: mocks.write, close: mocks.close },
}));
vi.mock("../terminal/sessions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureTerminalOutputListener: () => {},
}));
vi.mock("../contextPanelStore", () => ({
  useContextPanel: { getState: () => ({ show: mocks.show }) },
}));
vi.mock("../../personal/agentAccount", () => ({ agentAccountId: () => "local" }));

import { LaunchScriptButton, requestLaunchScriptEditor } from "./LaunchScriptActions";
import { useLaunchScripts } from "./launchScripts";
import { LAUNCH_TAB_KEY } from "./runLaunchScript";
import { useTerminalStore } from "../terminal/terminalStore";

const FOLDER = "/work/app";
const CHAT = "chat-1";
const SCOPE = `project-launch:local:${FOLDER}`;
const savedEntries = () =>
  (mocks.stored.get(SCOPE) as { entries: { label: string; script: string }[] } | undefined)
    ?.entries;

async function renderButton() {
  render(<LaunchScriptButton chat={CHAT} folder={FOLDER} />);
  await screen.findByRole("button", { name: /start command/i });
}

describe("LaunchScriptButton", () => {
  beforeEach(() => {
    mocks.stored.clear();
    mocks.open.mockClear();
    mocks.write.mockClear();
    mocks.close.mockClear();
    mocks.show.mockClear();
    useLaunchScripts.setState({ byFolder: {} });
    useTerminalStore.setState({ tabsByChat: {}, activeByChat: {}, launchTabs: {} });
  });
  afterEach(cleanup);

  it("opens the editor when nothing is set, and saving keeps the command", async () => {
    await renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Set start command" }));
    fireEvent.change(await screen.findByLabelText("Command"), {
      target: { value: "  npm run dev  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(savedEntries()).toMatchObject([{ script: "npm run dev" }]));
    expect(await screen.findByRole("button", { name: "Run start command" })).toBeTruthy();
  });

  it("runs the command in the chat's restarted launch tab and shows the terminal", async () => {
    mocks.stored.set(SCOPE, { entries: [{ id: "a", label: "", script: "npm run dev" }] });
    await renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Run start command" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalled());
    const launchTab =
      useTerminalStore.getState().launchTabs[`${CHAT}\n${FOLDER}\n${LAUNCH_TAB_KEY}`];
    expect(mocks.open).toHaveBeenCalledWith(launchTab, FOLDER, 120, 30);
    expect(mocks.write).toHaveBeenCalledWith(launchTab, "npm run dev\n");
    expect(mocks.show).toHaveBeenCalledWith("terminal");

    // A second run reuses the tab and starts its shell again first.
    fireEvent.click(screen.getByRole("button", { name: "Run start command" }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(launchTab));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
    expect(useTerminalStore.getState().tabsByChat[CHAT]).toHaveLength(1);
  });

  it("keeps the name given to the first command", async () => {
    await renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Set start command" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: " Dev " } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "npm run dev" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(savedEntries()).toMatchObject([{ label: "Dev", script: "npm run dev" }]),
    );
    expect(await screen.findByRole("button", { name: /Dev/ })).toBeTruthy();
  });

  it("opens the editor when another menu asks for it", async () => {
    await renderButton();
    act(() => requestLaunchScriptEditor(FOLDER));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("adds another named command from the new command section", async () => {
    mocks.stored.set(SCOPE, { entries: [{ id: "a", label: "", script: "npm run dev" }] });
    await renderButton();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Run start command" }));
    fireEvent.click(await screen.findByRole("button", { name: "New command" }));
    const names = screen.getAllByLabelText("Name");
    const commands = screen.getAllByLabelText("Command");
    fireEvent.change(names[1], { target: { value: "Tests" } });
    fireEvent.change(commands[1], { target: { value: "npm test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add command" }));
    await waitFor(() =>
      expect(savedEntries()).toMatchObject([
        { script: "npm run dev" },
        { label: "Tests", script: "npm test" },
      ]),
    );
    expect(await screen.findByRole("button", { name: /Tests/ })).toBeTruthy();
  });

  it("removes a command saved empty", async () => {
    mocks.stored.set(SCOPE, { entries: [{ id: "a", label: "", script: "npm run dev" }] });
    await renderButton();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Run start command" }));
    fireEvent.change(await screen.findByLabelText("Command"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(savedEntries()).toEqual([]));
    expect(await screen.findByRole("button", { name: "Set start command" })).toBeTruthy();
  });
});
