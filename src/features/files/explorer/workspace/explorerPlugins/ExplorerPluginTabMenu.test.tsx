import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useWorkspaceStore } from "@/features/workspace";
import type { PluginPanelEntry } from "@/native/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExplorerPluginTabMenu } from "./ExplorerPluginTabMenu";

const panel: PluginPanelEntry = {
  id: "quick-convert.panel",
  title: "Quick Convert",
  pluginId: "quick_convert",
  pluginName: "Quick Convert",
  windowType: "panel",
  defaultWidth: 520,
  defaultHeight: 420,
  pluginDir: "/extensions/quick_convert",
  manifestPath: "/extensions/quick_convert/manifest.json",
  libraryPath: "",
  webEntry: "web/index.html?plugin=quick_convert",
  launcherViews: ["files"],
};

function LocationProbe() {
  const location = useLocation();
  return <output data-location>{`${location.pathname}${location.search}`}</output>;
}

describe("ExplorerPluginTabMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("exposes an accessible launcher in Files", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/files"]}>
          <ExplorerPluginTabMenu commands={[]} panels={[panel]} selectedPath="" />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="Apps"]')).not.toBeNull();
  });

  it("launches an installed app into a workspace route", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/files"]}>
          <ExplorerPluginTabMenu
            commands={[]}
            panels={[panel]}
            selectedPath="/Users/misty/movie.mov"
          />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Apps"]')?.click();
    });
    const appItem = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes("Quick Convert"),
    );
    await act(async () => appItem?.click());

    expect(container.querySelector("[data-location]")?.textContent).toBe(
      "/apps/quick_convert?name=Quick+Convert&selected=%2FUsers%2Fmisty%2Fmovie.mov",
    );
    expect(useWorkspaceStore.getState().layout.root).toBeTruthy();
  });
});
