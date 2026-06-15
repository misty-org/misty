import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));

import {
  createOfficialAppNativeAccess,
  respondToOfficialAppCommand,
} from "./officialAppHostBridge";

describe("official app desktop host bridge", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.open.mockReset();
    mocks.openUrl.mockReset();
    mocks.invoke.mockImplementation((command: string, payload?: Record<string, unknown>) => {
      if (command === "official_app_resolve_granted_path") return payload?.candidate;
      return undefined;
    });
  });

  it("requires the exact app permission and rejects unknown commands", async () => {
    const source = { postMessage: vi.fn() };
    await respondToOfficialAppCommand(
      commandEvent(source, "code", "code.readFile", { path: "/tmp/private.txt" }),
      "code",
      ["code.write"],
      createOfficialAppNativeAccess(),
    );

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(source.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining("does not grant") }),
      { targetOrigin: "*" },
    );

    source.postMessage.mockClear();
    await respondToOfficialAppCommand(
      commandEvent(source, "code", "native.invokeAnything", {}),
      "code",
      ["code.read", "code.write"],
      createOfficialAppNativeAccess(),
    );
    expect(source.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining("does not grant") }),
      { targetOrigin: "*" },
    );
  });

  it("only exposes files beneath a folder chosen in that app window", async () => {
    const source = { postMessage: vi.fn() };
    const access = createOfficialAppNativeAccess();
    mocks.open.mockResolvedValue("/tmp/Shared");
    mocks.invoke.mockImplementation((command: string, payload?: Record<string, unknown>) => {
      if (command === "official_app_resolve_granted_path") return payload?.candidate;
      if (command === "explorer_list_directory") return { entries: [] };
      return undefined;
    });

    await respondToOfficialAppCommand(
      commandEvent(source, "files", "host.pickFolder", {}),
      "files",
      ["files.read"],
      access,
    );
    await respondToOfficialAppCommand(
      commandEvent(source, "files", "files.listDirectory", { path: "/tmp/Shared/docs" }),
      "files",
      ["files.read"],
      access,
    );

    expect(mocks.invoke).toHaveBeenCalledWith("explorer_list_directory", {
      request: { path: "/tmp/Shared/docs", showHidden: false, forceRemoteRefresh: false },
    });

    mocks.invoke.mockClear();
    await respondToOfficialAppCommand(
      commandEvent(source, "files", "files.openPath", { path: "/tmp/Sharedness/secret" }),
      "files",
      ["files.read"],
      access,
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(source.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining("not been granted") }),
      { targetOrigin: "*" },
    );
  });

  it("normalizes parent segments before checking folder containment", async () => {
    const source = { postMessage: vi.fn() };
    const access = createOfficialAppNativeAccess();
    mocks.open.mockResolvedValue("/tmp/Shared");

    await respondToOfficialAppCommand(
      commandEvent(source, "files", "host.pickFolder", {}),
      "files",
      ["files.read"],
      access,
    );
    mocks.invoke.mockClear();
    await respondToOfficialAppCommand(
      commandEvent(source, "files", "files.openPath", {
        path: "/tmp/Shared/../private.txt",
      }),
      "files",
      ["files.read"],
      access,
    );

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(source.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining("not been granted") }),
      { targetOrigin: "*" },
    );
  });

  it("only lets Terminal operate sessions created by the same app window", async () => {
    const source = { postMessage: vi.fn() };
    const access = createOfficialAppNativeAccess();
    mocks.invoke.mockResolvedValueOnce("session-owned").mockResolvedValue(undefined);

    await respondToOfficialAppCommand(
      commandEvent(source, "terminal", "terminal.create", { cols: 80, rows: 24 }),
      "terminal",
      ["terminal.execute"],
      access,
    );
    await respondToOfficialAppCommand(
      commandEvent(source, "terminal", "terminal.write", {
        sessionId: "session-owned",
        data: "pwd\n",
      }),
      "terminal",
      ["terminal.execute"],
      access,
    );
    await respondToOfficialAppCommand(
      commandEvent(source, "terminal", "terminal.kill", { sessionId: "someone-elses" }),
      "terminal",
      ["terminal.execute"],
      access,
    );

    expect(mocks.invoke).toHaveBeenCalledWith(
      "terminal_write",
      expect.objectContaining({ sessionId: "session-owned", data: "pwd\n" }),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "terminal_kill",
      expect.objectContaining({ sessionId: "someone-elses" }),
    );
  });
});

function commandEvent(
  source: { postMessage: ReturnType<typeof vi.fn> },
  appId: string,
  command: string,
  payload: Record<string, unknown>,
): MessageEvent {
  return {
    source,
    data: {
      type: "misty:app-command",
      protocol: 1,
      appId,
      requestId: "request-one",
      command,
      payload,
    },
  } as unknown as MessageEvent;
}
