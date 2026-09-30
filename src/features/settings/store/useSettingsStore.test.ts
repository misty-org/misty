import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  save: vi.fn(async ({ document }: { document: Record<string, unknown> }) => ({
    path: "cache",
    document,
  })),
  login: vi.fn(async (enabled: boolean) => ({
    supported: true,
    enabled,
    target: "test",
    detail: "",
  })),
  shortcuts: vi.fn(async (overrides: unknown[]) => ({ overrides })),
  writer: vi.fn(async () => {}),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/native", () => ({
  settingsSave: native.save,
  settingsApplyLaunchOnLogin: native.login,
  shortcutsReplace: native.shortcuts,
}));
vi.mock("@/features/app-shell", () => ({
  readNavigatorLayout: () => ({ autoHide: false }),
  publishNavigatorLayout: vi.fn(),
  configureStartupPreference: vi.fn(),
}));
vi.mock("@/features/webviews/browserRuntime", () => ({
  setBrowserDownloadDirectory: vi.fn(),
  setBrowserDownloadPrompt: vi.fn(),
  setBrowserStatusBubbleEnabled: vi.fn(),
}));
vi.mock("@/telemetry/lifecycle", () => ({ telemetryPreferencesChanged: vi.fn() }));
import { registerProfileWriter } from "../profiles/bridge";
import { useSettingsStore as store } from "./useSettingsStore";
import { useDockingLayoutStore } from "@/features/app-shell/dockingLayout";
beforeEach(() => {
  vi.clearAllMocks();
  registerProfileWriter(native.writer);
  store.setState({
    settings: { path: "cache", document: {} },
    shortcuts: null,
    error: null,
    launchOnLogin: { supported: true, enabled: false, target: "test", detail: "" },
  });
});
describe("server preference runtime projection", () => {
  it("routes formerly device-only settings to the account writer", () => {
    store.getState().updateSetting("appearance", "app_zoom", 1.5);
    store.getState().updateSetting("general", "browser_download_directory", "/downloads");
    expect(native.writer).toHaveBeenCalledWith("app.zoom", 1.5);
    expect(native.writer).toHaveBeenCalledWith("browser.downloads.directory", "/downloads");
    expect(native.save).not.toHaveBeenCalled();
  });
  it("applies received launch, shortcut, preset and Open With preferences", async () => {
    const shortcuts = [{ commandId: "workspace.new_tab", primary: null, alternate: "Ctrl+N" }];
    const layouts = [{ id: "one", name: "Writing", navigation: "right", tabs: "top" }];
    await store.getState().applyProfileValues({
      "app.startup.login": true,
      "app.shortcuts.bindings": JSON.stringify(shortcuts),
      "app.layout.presets": JSON.stringify(layouts),
      "files.openWith": JSON.stringify({ ".txt": "/Applications/Editor.app" }),
    });
    expect(native.login).toHaveBeenCalledWith(true);
    expect(native.shortcuts).toHaveBeenCalledWith(shortcuts);
    expect(useDockingLayoutStore.getState().savedLayouts).toEqual(layouts);
    expect(store.getState().openWithAssociations).toEqual([
      { key: ".txt", applicationPath: "/Applications/Editor.app" },
    ]);
    expect(store.getState().settings?.document.general).toMatchObject({ launch_on_login: true });
  });
  it("reassigns shortcuts as one shared mutation, including the unbound conflict", async () => {
    await store.getState().reassignShortcut({
      commandId: "workspace.new_tab",
      slot: "primary",
      value: "Ctrl+N",
      conflictingCommandId: "files.new",
      conflictingSlot: "primary",
    });
    expect(native.writer).toHaveBeenCalledOnce();
    const args = (native.writer.mock.calls as unknown as [string, string][])[0];
    expect(args[0]).toBe("app.shortcuts.bindings");
    expect(JSON.parse(args[1])).toEqual([
      { commandId: "files.new", primary: null },
      { commandId: "workspace.new_tab", primary: "Ctrl+N" },
    ]);
  });
  it("resets a shortcut without dropping unrelated account overrides", async () => {
    store.setState({
      settings: {
        path: "cache",
        document: {
          shortcuts: {
            overrides_json: JSON.stringify([
              { commandId: "a", primary: "F1" },
              { commandId: "b", alternate: null },
            ]),
          },
        },
      },
    });
    await store.getState().resetShortcuts({ commandId: "a" });
    expect(native.writer).toHaveBeenCalledWith(
      "app.shortcuts.bindings",
      JSON.stringify([{ commandId: "b", alternate: null }]),
    );
  });
  it("ignores a projection for a superseded account", async () => {
    await store.getState().applyProfileValues({ "app.zoom": 2 }, () => false);
    expect(native.save).not.toHaveBeenCalled();
    expect(native.login).not.toHaveBeenCalled();
  });
  it("rejects unregistered updates instead of quietly storing them locally", () => {
    store.getState().updateSetting("unknown", "key", true);
    expect(store.getState().error).toContain("Unknown setting");
    expect(native.writer).not.toHaveBeenCalled();
    expect(native.save).not.toHaveBeenCalled();
  });
});
