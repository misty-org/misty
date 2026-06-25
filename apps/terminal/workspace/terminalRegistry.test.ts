import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bufferBySlot,
  cwdBySlot,
  killTerminalTab,
  registerSlot,
  retainTerminalSession,
  sessionBySlot,
  slotsByTab,
  titleBySlot,
} from "./terminalRegistry";

const close = vi.fn(() => Promise.resolve());

describe("terminal dock lifecycle", () => {
  beforeEach(() => {
    close.mockClear();
    sessionBySlot.clear();
    bufferBySlot.clear();
    cwdBySlot.clear();
    titleBySlot.clear();
    slotsByTab.clear();
  });

  it("kills a dock tab PTY exactly once and forgets all retained state", () => {
    registerSlot("tab:terminal", "slot:terminal");
    retainTerminalSession("slot:terminal", "session:terminal", close);
    bufferBySlot.set("slot:terminal", "scrollback");
    cwdBySlot.set("slot:terminal", "/tmp");
    titleBySlot.set("slot:terminal", "zsh");

    killTerminalTab("tab:terminal");
    killTerminalTab("tab:terminal");

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith();
    expect(slotsByTab.has("tab:terminal")).toBe(false);
    expect(sessionBySlot.has("slot:terminal")).toBe(false);
    expect(bufferBySlot.has("slot:terminal")).toBe(false);
    expect(cwdBySlot.has("slot:terminal")).toBe(false);
    expect(titleBySlot.has("slot:terminal")).toBe(false);
  });

  it("keeps one stable slot owner while a dock surface is visually unmounted", () => {
    registerSlot("tab:terminal", "slot:first");
    registerSlot("tab:terminal", "slot:second");
    retainTerminalSession("slot:second", "session:second", close);

    killTerminalTab("tab:terminal");

    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith();
  });
});
