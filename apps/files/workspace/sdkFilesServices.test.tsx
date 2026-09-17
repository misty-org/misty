import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "@/features/coding-workspace/sdkCodeProject.fixture";
import { createSdkFilesStore } from "./sdkFilesStore";
import { createSdkFilesServices } from "./sdkFilesServices";
import type { SdkFilesWorkspace } from "./sdkFilesWorkspace";

it("loads Home files and recovers from an initial source lookup failure", async () => {
  const fixture = createSdkCodeFileFixture();
  const lifetime = new AbortController();
  const files = createSdkFilesStore(fixture.sdk, lifetime.signal);
  const sources = vi
    .spyOn(fixture.sdk.files, "sources")
    .mockRejectedValueOnce(new Error("Sources unavailable"))
    .mockResolvedValue([
      {
        id: "local:home",
        name: "Home",
        kind: "local",
        providerType: "folder",
        online: true,
        writable: true,
      },
    ]);
  vi.spyOn(fixture.sdk.storage.local, "get").mockResolvedValue(null);
  vi.spyOn(fixture.sdk.files, "openSource").mockImplementation(async () => ({
    ...(await fixture.sdk.files.pickDirectory({ write: true }))!,
    writable: true,
  }));
  const workspace = {
    files,
    ready: Promise.resolve(),
    openView: vi.fn(),
  } as unknown as SdkFilesWorkspace;
  const services = await createSdkFilesServices(fixture.sdk, workspace, lifetime.signal, vi.fn());
  const status = renderHook(() => services.useSourceStatus!());
  try {
    expect(status.result.current.error).toBe("Sources unavailable");
    await act(async () => services.retrySources!());
    expect(status.result.current.error).toBeNull();
    expect(files.store.getState().folders[0].source?.id).toBe("local:home");
    expect(files.store.getState().pane.listing?.entries.length).toBeGreaterThan(0);
    expect(sources).toHaveBeenCalledTimes(2);
  } finally {
    status.unmount();
    await services.close();
    await files.close();
    lifetime.abort();
  }
});

it("resolves native search destinations into the owning source's SDK folder", async () => {
  const fixture = createSdkCodeFileFixture();
  const lifetime = new AbortController();
  const files = createSdkFilesStore(fixture.sdk, lifetime.signal);
  vi.spyOn(fixture.sdk.files, "sources").mockResolvedValue([
    {
      id: "local:home",
      name: "Home",
      kind: "local",
      providerType: "folder",
      online: true,
      writable: true,
    },
  ]);
  vi.spyOn(fixture.sdk.storage.local, "get").mockResolvedValue(null);
  vi.spyOn(fixture.sdk.files, "openSource").mockImplementation(async () => ({
    ...(await fixture.sdk.files.pickDirectory({ write: true }))!,
    writable: true,
  }));
  const resolveLocation = vi
    .spyOn(fixture.sdk.files, "resolveLocation")
    .mockResolvedValue({ sourceId: "local:home", relative: ["src"] });
  const services = await createSdkFilesServices(
    fixture.sdk,
    { files, ready: Promise.resolve(), openView: vi.fn() } as unknown as SdkFilesWorkspace,
    lifetime.signal,
    vi.fn(),
  );
  try {
    const folder = files.store.getState().folders[0];
    expect(await services.resolvePath!("/Users/test/src")).toBe(`${folder.root}/src`);
    expect(resolveLocation).toHaveBeenCalledWith("/Users/test/src");
  } finally {
    await services.close();
    await files.close();
    lifetime.abort();
  }
});
