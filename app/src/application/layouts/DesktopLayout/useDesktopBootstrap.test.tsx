import { useSettingsStore } from "@/features/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesktopBootstrap } from "./useDesktopBootstrap";

vi.mock("@/features/files/explorer", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    preloadDesktopFilesPage: vi.fn(() => Promise.resolve()),
  };
});

function BootstrapProbe() {
  useDesktopBootstrap({ getRouteId: () => "home" });
  return null;
}

describe("useDesktopBootstrap", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useSettingsStore.setState({
      settings: {
        path: "settings.json",
        document: {
          search: {
            automatic_file_discovery_enabled: true,
            discovery_interval_minutes: 15,
            ignored_paths: "node_modules, dist",
          },
        },
      },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useSettingsStore.setState({ settings: null });
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("keeps the settings snapshot stable when derived preferences contain arrays", async () => {
    await expect(
      act(async () => {
        root.render(
          <MemoryRouter initialEntries={["/home"]}>
            <BootstrapProbe />
          </MemoryRouter>,
        );
      }),
    ).resolves.toBeUndefined();
  });
});
