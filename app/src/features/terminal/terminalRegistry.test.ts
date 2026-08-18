import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bufferBySlot,
  cwdBySlot,
  killTerminalTab,
  registerSlot,
  sessionBySlot,
  slotsByTab,
  titleBySlot,
} from "./terminalRegistry";

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("terminal dock lifecycle", () => {
  beforeEach(() => {
    invoke.mockClear();
    sessionBySlot.clear();
    bufferBySlot.clear();
    cwdBySlot.clear();
    titleBySlot.clear();
    slotsByTab.clear();
  });

  it("kills a dock tab PTY exactly once and forgets all retained state", () => {
    registerSlot("tab:terminal", "slot:terminal");
    sessionBySlot.set("slot:terminal", "session:terminal");
    bufferBySlot.set("slot:terminal", "scrollback");
    cwdBySlot.set("slot:terminal", "/tmp");
    titleBySlot.set("slot:terminal", "zsh");

    killTerminalTab("tab:terminal");
    killTerminalTab("tab:terminal");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("terminal_kill", {
      sessionId: "session:terminal",
    });
    expect(slotsByTab.has("tab:terminal")).toBe(false);
    expect(sessionBySlot.has("slot:terminal")).toBe(false);
    expect(bufferBySlot.has("slot:terminal")).toBe(false);
    expect(cwdBySlot.has("slot:terminal")).toBe(false);
    expect(titleBySlot.has("slot:terminal")).toBe(false);
  });

  it("keeps one stable slot owner while a dock surface is visually unmounted", () => {
    registerSlot("tab:terminal", "slot:first");
    registerSlot("tab:terminal", "slot:second");
    sessionBySlot.set("slot:second", "session:second");

    killTerminalTab("tab:terminal");

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("terminal_kill", { sessionId: "session:second" });
  });
});
