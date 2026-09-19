import { pluginCatalogChangedEvent } from "@/features/extensions";
import type { PluginCommandsSnapshot, PluginPanelEntry } from "@/native/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePluginRegistry } from "./usePluginRegistry";

const mocks = vi.hoisted(() => ({
  pluginCommandsSnapshot: vi.fn<() => Promise<PluginCommandsSnapshot>>(),
}));

vi.mock("@/features/files/native", () => ({
  explorerPrepareDragItems: vi.fn(),
  explorerCancelDragPreparation: vi.fn(),
  pluginCommandsSnapshot: mocks.pluginCommandsSnapshot,
}));

const panel: PluginPanelEntry = {
  id: "themes.panel",
  title: "Themes",
  pluginId: "themes",
  pluginName: "Themes",
  windowType: "panel",
  defaultWidth: 560,
  defaultHeight: 620,
  pluginDir: "/extensions/themes",
  manifestPath: "/extensions/themes/manifest.json",
  libraryPath: "",
  webEntry: "web/index.html?plugin=themes",
  launcherViews: ["files"],
};

const emptySnapshot: PluginCommandsSnapshot = { roots: [], commands: [], panels: [] };

function RegistryProbe(props: { enabled: boolean }) {
  const registry = usePluginRegistry({ extensionsEnabled: props.enabled });
  return <output data-panel-count>{registry.pluginPanels.length}</output>;
}

describe("usePluginRegistry", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.pluginCommandsSnapshot.mockReset();
    mocks.pluginCommandsSnapshot.mockResolvedValue(emptySnapshot);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps the native registry inactive when extensions are unsupported", async () => {
    await act(async () => {
      root.render(<RegistryProbe enabled={false} />);
      await Promise.resolve();
    });

    expect(mocks.pluginCommandsSnapshot).not.toHaveBeenCalled();
  });

  it("refreshes installed panels as soon as the catalog changes", async () => {
    mocks.pluginCommandsSnapshot
      .mockResolvedValueOnce(emptySnapshot)
      .mockResolvedValue({ roots: ["/extensions"], commands: [], panels: [panel] });

    await act(async () => {
      root.render(<RegistryProbe enabled />);
      await Promise.resolve();
    });
    expect(mocks.pluginCommandsSnapshot).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-panel-count]")?.textContent).toBe("0");

    await act(async () => {
      window.dispatchEvent(new Event(pluginCatalogChangedEvent));
      await Promise.resolve();
    });

    expect(mocks.pluginCommandsSnapshot).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-panel-count]")?.textContent).toBe("1");
  });
});
