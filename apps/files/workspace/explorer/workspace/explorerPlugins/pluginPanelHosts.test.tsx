import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeAppViewProps } from "@/features/apps/NativeAppView";
import type { PluginPanelEntry } from "@/native/contracts";
import { ExplorerNativePluginPanelHost, ExplorerWebPluginPanelHost } from "./pluginPanelHosts";

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  selected: vi.fn(),
  panelRender: vi.fn(),
  execute: vi.fn(),
  reset: vi.fn(),
  invoke: vi.fn(),
}));
let latest: NativeAppViewProps;
vi.mock("@/features/apps/NativeAppView", () => ({
  NativeAppView: (props: NativeAppViewProps) => {
    latest = props;
    return <div>Native app</div>;
  },
}));
vi.mock("@/features/apps/useNativeAppPermissions", () => ({
  useNativeAppPermissions: () => ({
    execute: mocks.execute,
    reset: mocks.reset,
    controls: null,
    active: false,
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("@/features/workspace/useWorkspaceStore", () => ({
  useWorkspaceStore: (select: (state: { activeScopeKey: string }) => unknown) =>
    select({ activeScopeKey: "space:studio" }),
}));
vi.mock("@/features/files/native", () => ({
  extensionCommandRun: mocks.command,
  pluginPanelRender: mocks.panelRender,
}));
vi.mock("@/features/activity", () => ({ SystemErrorActivity: () => null }));
vi.mock("@/features/settings", () => ({
  extensionThemeChangedEvent: "test-theme",
  extensionThemeSnapshot: () => ({ mode: "dark" }),
  revertExtensionThemePreview: vi.fn(),
  runExtensionThemeCommand: vi.fn(),
}));
vi.mock("../../store", () => ({
  selectedPathsForPane: mocks.selected,
  useExplorerStore: { getState: () => ({ panes: {} }) },
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
afterEach(cleanup);

it.each([
  "storage_report",
  "themes",
  "image_optimizer",
  "quick_convert",
  "backups",
  "ytdlp",
])(
  "migrated %s receives no selected host paths and cannot fall back to legacy commands",
  async (pluginId) => {
    const panel = {
      id: "storage-report.panel",
      pluginId,
      pluginName: "Storage Report",
      title: "Storage Report",
      pluginDir: "/fixture/.misty/plugins/private/storage_report",
      webEntry:
        "/fixture/.misty/plugins/private/storage_report/web/index.html?plugin=storage_report",
    } as PluginPanelEntry;
    render(<ExplorerWebPluginPanelHost panel={panel} selectedPath="/private/user/documents" />);
    expect(latest.owner).toEqual({ accountId: "account", spaceId: "studio" });
    expect(latest.context).toMatchObject({ selectedPaths: [] });
    expect(JSON.stringify(latest.context)).not.toContain("/private/user/documents");
    for (const command of [
      "host.selectedPaths",
      "storage_report.start",
      "backups.restore",
      "themes.apply",
    ]) {
      await expect(
        latest.onRequest(
          { channel: "misty-plugin", kind: "request", command, payload: { root: "/" } },
          new AbortController().signal,
        ),
      ).rejects.toThrow("capability API");
    }
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.selected).not.toHaveBeenCalled();
  },
);

it("runs validated widget actions through an account and Space-owned capability session", async () => {
  mocks.invoke.mockImplementation(async (command) =>
    command === "mini_widget_open" ? "widget-instance" : null,
  );
  mocks.execute.mockResolvedValue(null);
  mocks.panelRender.mockImplementation(async (request) => ({
    panelId: "widget.panel",
    pluginId: "widget",
    pluginName: "Widget",
    title: "Widget",
    runtimeStatus: "native_rendered",
    notifications: [],
    message: "",
    elements: [
      { kind: "input", id: "message", text: "Message", width: 0, height: 0, border: false },
      {
        kind: "button",
        id: "copy",
        text: "Copy",
        width: 0,
        height: 0,
        border: false,
        action: {
          method: "clipboard.writeText",
          value: `Hello ${request.inputs?.message ?? ""}`,
        },
      },
    ],
  }));
  const panel = {
    id: "widget.panel",
    pluginId: "widget",
    pluginName: "Widget",
    title: "Widget",
    pluginDir: "/fixture/.misty/plugins/private/widget",
    declarativeUi: { version: 2, elements: [] },
  } as unknown as PluginPanelEntry;
  const view = render(<ExplorerNativePluginPanelHost panel={panel} selectedPath="" />);
  const input = await view.findByPlaceholderText("Message");
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("mini_widget_open", {
      request: {
        root: "/fixture/.misty/plugins/private/widget",
        owner: { accountId: "account", spaceId: "studio" },
      },
    }),
  );
  fireEvent.change(input, { target: { value: "Misty" } });
  fireEvent.click(view.getByText("Copy"));
  await view.findByText("Copied to the clipboard.");
  expect(mocks.execute).toHaveBeenCalledWith("widget-instance", "clipboard.writeText", {
    text: "Hello Misty",
  });
  view.unmount();
  expect(mocks.reset).toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith("mini_app_close", { instance: "widget-instance" });
});
