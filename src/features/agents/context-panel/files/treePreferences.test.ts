// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readDeviceState: vi.fn(), updateDeviceState: vi.fn() }));
vi.mock("../folders/deviceState", () => mocks);
vi.mock("../../personal/agentAccount", () => ({ agentAccountId: () => "me" }));

import { useTreePreferences } from "./treePreferences";

describe("file tree preferences", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useTreePreferences.setState({ hideIgnored: false });
  });

  it("lists ignored entries when nothing was saved", async () => {
    mocks.readDeviceState.mockResolvedValue(null);
    await useTreePreferences.getState().hydrate();
    expect(useTreePreferences.getState().hideIgnored).toBe(false);
  });

  it("reads the saved switch", async () => {
    mocks.readDeviceState.mockResolvedValue({ hideIgnored: true });
    await useTreePreferences.getState().hydrate();
    expect(useTreePreferences.getState().hideIgnored).toBe(true);
  });

  it("keeps the default when the read fails", async () => {
    mocks.readDeviceState.mockRejectedValue(new Error("unreadable"));
    await useTreePreferences.getState().hydrate();
    expect(useTreePreferences.getState().hideIgnored).toBe(false);
  });

  it("applies at once, and a read that began before a write doesn't undo it", async () => {
    let finish!: () => void;
    mocks.updateDeviceState.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    mocks.readDeviceState.mockResolvedValue({ hideIgnored: false });
    const pending = useTreePreferences.getState().setHideIgnored(true);
    expect(useTreePreferences.getState().hideIgnored).toBe(true);
    await useTreePreferences.getState().hydrate();
    expect(useTreePreferences.getState().hideIgnored).toBe(true);
    finish();
    await pending;
    expect(mocks.updateDeviceState).toHaveBeenCalledWith(
      "project-files:me",
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("rolls back a write that failed", async () => {
    mocks.updateDeviceState.mockRejectedValue(new Error("no disk"));
    await expect(useTreePreferences.getState().setHideIgnored(true)).rejects.toThrow("no disk");
    expect(useTreePreferences.getState().hideIgnored).toBe(false);
  });
});
