import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MistyAppSDK } from "@misty/sdk";
import { DownloadedAppSurface } from "./DownloadedAppSurface";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  reset: vi.fn(),
  execute: vi.fn(),
  account: "user-a",
}));
vi.mock("@/features/ai-surface/AiPaneHost", () => ({ useAiSurfaceAdapter: vi.fn() }));
vi.mock("./rpc/appUiBackend", () => ({ createAppUiBackend: () => ({}) }));
vi.mock("@/features/workspace/useWorkspaceStore", () => ({ useWorkspaceStore: () => false }));
vi.mock("./desktopAppLoader", () => ({ loadDesktopApp: mocks.load }));
vi.mock("./rpc/nativeBackend", () => ({
  nativeRpcBackend: { invoke: mocks.invoke, listen: mocks.listen },
}));
vi.mock("./useNativeAppPermissions", () => ({
  isNativeDeviceMethod: (method: string) => method.startsWith("files."),
  useNativeAppPermissions: () => ({ execute: mocks.execute, reset: mocks.reset, controls: null }),
}));
vi.mock("@/features/settings", () => ({
  useAppThemeStore: (selector: (state: { resolvedTheme: string }) => unknown) =>
    selector({ resolvedTheme: "dark" }),
}));
vi.mock("@/features/auth/store/useAuthTokenStore", () => ({
  readActiveSavedAccountSession: () => ({ id: mocks.account }),
}));
vi.mock("./appCapabilityGateway", () => ({
  executeAppCapability: vi.fn(async () => ({ appId: "com.misty.terminal" })),
}));
const app = {
  id: "terminal",
  app_id: "com.misty.terminal",
  name: "Terminal",
  version: "1",
  scopes: ["terminal.execute"],
  desktop: { runtime: "downloaded", sha256: "hash" },
  mobile: { runtime: "unsupported" },
} as never;
const session = {
  app_id: "terminal",
  space_id: "space-a",
  token: "host-only",
  expires_at: "2099-01-01T00:00:00Z",
  scopes: ["terminal.execute"],
  sdk_base_url: "/app-runtime",
};
const props = {
  app,
  session,
  serverBase: "https://misty.example/v1",
  user: { id: "user-a", name: "User", email: "user@example.com" },
  route: "/apps/terminal",
  active: true,
  onNavigate: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = "user-a";
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "terminal_create" ? "native-terminal" : undefined,
  );
  mocks.listen.mockResolvedValue(vi.fn());
});
describe("downloaded SDK component host", () => {
  it("keeps raw collaboration join tickets out of downloaded component transports", async () => {
    let sdk!: MistyAppSDK;
    mocks.load.mockResolvedValue({
      appId: "terminal",
      protocol: 2,
      mount: ({ root, misty }: { root: HTMLElement; misty: MistyAppSDK }) => {
        sdk = misty;
        root.textContent = "Transport ready";
        return { update: vi.fn(), unmount: vi.fn() };
      },
    });
    const view = render(<DownloadedAppSurface {...props} />);
    await screen.findByText("Transport ready");
    await expect(sdk.collaboration.createTicket("note", "note-a")).rejects.toMatchObject({
      code: "host_owned_connection",
    });
    await expect(
      sdk.server.call("drawings.collaboration.ticket", { path: { drawingID: "drawing-a" } }),
    ).rejects.toMatchObject({ code: "host_owned_connection" });
    await expect(
      sdk.server.call("notes.assets.download", { path: { noteID: "note-a", assetID: "asset-a" } }),
    ).rejects.toMatchObject({ code: "host_owned_transfer" });
    await expect(
      sdk.server.call("drawings.assets.reserve", {
        path: { drawingID: "drawing-a" },
        body: {
          file_id: "file-a",
          filename: "image.png",
          mime_type: "image/png",
          byte_size: 3,
          sha256: "0".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "host_owned_transfer" });
    await expect(
      sdk.server.call("notes.assets.finalize", {
        path: { noteID: "note-a", uploadID: "upload-a" },
      }),
    ).rejects.toMatchObject({ code: "host_owned_transfer" });
    view.unmount();
  });
  it("mounts exported components with SDK transport and kills owned native resources on close", async () => {
    let sdk!: MistyAppSDK;
    const update = vi.fn();
    const unmount = vi.fn();
    mocks.load.mockResolvedValue({
      appId: "terminal",
      protocol: 2,
      mount: async ({ root, misty }: { root: HTMLElement; misty: MistyAppSDK }) => {
        sdk = misty;
        await misty.terminal.create();
        root.textContent = "Downloaded terminal";
        return { update, unmount };
      },
    });
    const view = render(<DownloadedAppSurface {...props} />);
    await screen.findByText("Downloaded terminal");
    expect(mocks.invoke).toHaveBeenCalledWith("terminal_create", { request: { env: {} } });
    expect(view.container.querySelector("iframe")).toBeNull();
    view.rerender(
      <DownloadedAppSurface
        {...props}
        active={false}
        session={{ ...session, token: "refreshed-host-only" }}
      />,
    );
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ active: false })),
    );
    expect(mocks.load).toHaveBeenCalledOnce();
    view.unmount();
    await waitFor(() => expect(unmount).toHaveBeenCalledOnce());
    expect(mocks.invoke).toHaveBeenCalledWith("terminal_kill", { sessionId: "native-terminal" });
    await expect(sdk.context.get()).rejects.toMatchObject({ code: "app_closed" });
  });
  it("routes language-server SDK requests and events from an exported component and stops on unmount", async () => {
    let sdk!: MistyAppSDK;
    let handle = "";
    let nativeEvent!: (payload: unknown) => void;
    const received = vi.fn();
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "code_lsp_start" ? "native-lsp" : undefined,
    );
    mocks.listen.mockImplementation(async (event: string, listener: (payload: unknown) => void) => {
      if (event === "misty://code-lsp-message") nativeEvent = listener;
      return vi.fn();
    });
    mocks.load.mockResolvedValue({
      appId: "terminal",
      protocol: 2,
      mount: async ({ root, misty }: { root: HTMLElement; misty: MistyAppSDK }) => {
        sdk = misty;
        handle = (await misty.code.lsp.start("cpp", "/tmp/project")).handle;
        await misty.code.lsp.subscribe(handle, received);
        root.textContent = "Language server ready";
        return { update: vi.fn(), unmount: vi.fn() };
      },
    });
    const view = render(
      <DownloadedAppSurface
        {...props}
        app={{ ...(app as object), scopes: ["code.execute"] } as typeof app}
        session={{ ...session, scopes: ["code.execute"] }}
      />,
    );
    await screen.findByText("Language server ready");
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    nativeEvent({ sessionId: "native-lsp", payload });
    expect(received).toHaveBeenCalledWith({ type: "message", payload });
    await sdk.code.lsp.send(handle, payload);
    expect(mocks.invoke).toHaveBeenCalledWith("code_lsp_send", {
      sessionId: "native-lsp",
      payload,
    });
    view.unmount();
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("code_lsp_stop", { sessionId: "native-lsp" }),
    );
    await expect(sdk.code.lsp.send(handle, payload)).rejects.toMatchObject({ code: "app_closed" });
  });
  it("survives Strict Mode's setup/cleanup cycle without mounting a stale instance", async () => {
    const mount = vi.fn(({ root }: { root: HTMLElement }) => {
      root.textContent = "Ready";
      return { update: vi.fn(), unmount: vi.fn() };
    });
    mocks.load.mockResolvedValue({ appId: "terminal", protocol: 2, mount });
    const view = render(
      <StrictMode>
        <DownloadedAppSurface {...props} />
      </StrictMode>,
    );
    await screen.findByText("Ready");
    expect(mount).toHaveBeenCalledOnce();
    view.unmount();
  });
  it("refuses to execute packages after the active account changes", async () => {
    let resolve!: (value: unknown) => void;
    const mount = vi.fn();
    mocks.load.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<DownloadedAppSurface {...props} />);
    mocks.account = "another-user";
    await act(async () => {
      resolve({ appId: "terminal", protocol: 2, mount });
    });
    expect(mount).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toContain("account changed");
    view.unmount();
  });
  it("decodes native binary data for SDK components and binds device grants to the owner", async () => {
    let bytes: ArrayBuffer | undefined;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "scan_local_plugins")
        return [{ id: "terminal", root: "public", plugin_dir: "/installed/terminal" }];
      if (command === "mini_widget_open") return "device-instance";
      return undefined;
    });
    mocks.execute.mockResolvedValue({ $mistyBytes: [0, 127, 255] });
    mocks.load.mockResolvedValue({
      appId: "terminal",
      protocol: 2,
      mount: async ({ root, misty }: { root: HTMLElement; misty: MistyAppSDK }) => {
        bytes = await misty.files.readBytes("granted-file", 0, 3);
        root.textContent = "Binary ready";
        return { update: vi.fn(), unmount: vi.fn() };
      },
    });
    const view = render(<DownloadedAppSurface {...props} />);
    await screen.findByText("Binary ready");
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(bytes!))).toEqual([0, 127, 255]);
    expect(mocks.invoke).toHaveBeenCalledWith("mini_widget_open", {
      request: {
        root: "/installed/terminal",
        owner: { accountId: "user-a", spaceId: "space-a" },
        scopeLimit: ["terminal.execute"],
      },
    });
    view.unmount();
    expect(mocks.invoke).toHaveBeenCalledWith("mini_app_close", { instance: "device-instance" });
  });
});
