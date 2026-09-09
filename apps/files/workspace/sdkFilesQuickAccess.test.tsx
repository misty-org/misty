import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useState } from "react";
import { createSdkCodeFileFixture } from "@/features/coding-workspace/sdkCodeProject.fixture";
import { createSdkFilesStore } from "./sdkFilesStore";
import { createSdkFilesQuickAccess } from "./sdkFilesQuickAccess";
import type { ExplorerSidebarProps } from "./explorer/model/interfaces/components/ExplorerSidebar";

it("lists only chosen folders and retains the existing hide/reset interactions", async () => {
  const fixture = createSdkCodeFileFixture(),
    lifetime = new AbortController();
  const files = createSdkFilesStore(fixture.sdk, lifetime.signal);
  const useQuickAccess = createSdkFilesQuickAccess(files);
  const noop = () => undefined;
  const sidebar: ExplorerSidebarProps = {
    homePath: "/ungranted/home",
    activePath: "",
    mountRoot: "",
    pinnedPaths: [],
    remotes: [],
    remoteLoading: false,
    library: null,
    devices: [],
    devicesLoading: false,
    androidLocal: false,
    androidAllFilesAccess: null,
    androidGrantedFolders: [],
    onNavigate: noop,
    onRefreshDevices: noop,
    onOpenInNewTab: noop,
    onManageRemotes: noop,
    onAddRemote: noop,
    onGrantLocalFolder: noop,
    onUnpinPinnedPath: noop,
  };
  const view = renderHook(() => {
    const [hiddenQuickAccessPaths, setHiddenQuickAccessPaths] = useState<string[]>([]);
    return useQuickAccess({ sidebar, hiddenQuickAccessPaths, setHiddenQuickAccessPaths });
  });
  expect(view.result.current.visibleQuickAccess).toEqual([]);
  await act(async () => {
    await files.openFolder();
  });
  expect(view.result.current.visibleQuickAccess).toMatchObject([
    { label: "Project", path: files.store.getState().folders[0].root },
  ]);
  act(() => view.result.current.toggleQuickAccessDefault(view.result.current.quickAccess[0].path));
  expect(view.result.current.visibleQuickAccess).toEqual([]);
  act(() => view.result.current.resetQuickAccessDefaults());
  expect(view.result.current.visibleQuickAccess).toHaveLength(1);
  view.unmount();
  lifetime.abort();
  await files.close();
  expect(fixture.handles.size).toBe(0);
});
