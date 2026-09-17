import { createElement, useEffect, useState } from "react";
import { act, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MistyAppSDK, MistyComponentContext } from "@misty/sdk";

const mocks = vi.hoisted(() => ({
  mount: vi.fn(),
  close: vi.fn(),
  servicesClose: vi.fn(),
  detach: vi.fn(),
  model: vi.fn(),
  navigate: vi.fn(),
  select: vi.fn(),
  resolvePath: vi.fn(async (path: string) => path),
  historyClose: vi.fn(),
}));
vi.mock("../../../../misty-apps/apps/files/workspace/sdkFilesWorkspace", () => ({
  createSdkFilesWorkspace: () => ({
    ready: Promise.resolve(),
    close: mocks.close,
    model: { setState: mocks.model },
    files: {
      navigate: mocks.navigate,
      select: mocks.select,
      store: {
        getState: () => ({
          pane: { listing: { entries: [{ id: "report", name: "report.pdf" }] } },
        }),
      },
    },
  }),
}));
vi.mock("../../../../misty-apps/apps/files/workspace/sdkFilesServices", () => ({
  createSdkFilesServices: async () => ({
    close: mocks.servicesClose,
    resolvePath: mocks.resolvePath,
  }),
}));
vi.mock("../../../../misty-apps/apps/files/workspace/sdkFilesTransferHistory", () => ({
  createSdkFilesTransferHistory: () => ({
    register: async () => mocks.detach,
    close: mocks.historyClose,
  }),
}));
vi.mock("../../../../misty-apps/apps/files/workspace/SdkFilesWorkspaceView", () => ({
  SdkFilesWorkspaceView: () => {
    const [text, setText] = useState("");
    useEffect(() => {
      mocks.mount();
    }, []);
    return createElement("input", {
      "aria-label": "Explorer selection",
      value: text,
      onChange: (event: { target: { value: string } }) => setText(event.target.value),
    });
  },
}));
vi.mock("../../../../misty-apps/apps/files/workspace/SdkFilesTransfersView", () => ({
  SdkFilesTransfersView: () => createElement("div", null, "Package transfers"),
}));
import files from "../../../../misty-apps/apps/files/index";
const context: MistyComponentContext = {
  instanceId: "files-view",
  route: "/apps/files",
  active: true,
  appearance: { mode: "dark" },
};
let mounted: Awaited<ReturnType<typeof files.mount>> | undefined;
let root: HTMLElement;
beforeEach(() => {
  vi.clearAllMocks();
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(async () => {
  await act(async () => {
    await mounted?.unmount();
  });
  mounted = undefined;
  root.remove();
  cleanup();
});
function sdk() {
  return {
    navigation: { setItems: vi.fn() },
    activity: { report: vi.fn(async () => {}) },
    fileSystem: {
      mountWorkspace: vi.fn(() => {
        throw new Error("Host Files UI must not be used");
      }),
    },
  } as unknown as MistyAppSDK;
}
it("owns Explorer and Transfers in the package and preserves Explorer state while switching", async () => {
  const misty = sdk();
  await act(async () => {
    mounted = await files.mount({ root, misty, context });
  });
  fireEvent.change(await screen.findByLabelText("Explorer selection"), {
    target: { value: "kept selection" },
  });
  await act(async () => {
    await mounted!.update({ ...context, route: "/apps/files?view=transfers" });
  });
  expect(screen.getByText("Package transfers")).toBeTruthy();
  expect(mocks.model).toHaveBeenLastCalledWith({ active: false });
  await act(async () => {
    await mounted!.update(context);
  });
  expect((screen.getByLabelText("Explorer selection") as HTMLInputElement).value).toBe(
    "kept selection",
  );
  expect(mocks.mount).toHaveBeenCalledTimes(1);
  expect(misty.fileSystem.mountWorkspace).not.toHaveBeenCalled();
});
it("resolves global search routes through SDK services and releases scoped state on abort", async () => {
  const controller = new AbortController();
  await act(async () => {
    mounted = await files.mount({
      root,
      misty: sdk(),
      context: { ...context, route: "/apps/files?path=%2Fdocs%2Freport.pdf&select=report.pdf" },
      signal: controller.signal,
    });
  });
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/docs", "replace"));
  expect(mocks.select).toHaveBeenCalledWith("report");
  await act(async () => {
    controller.abort();
    await mounted!.unmount();
  });
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(mocks.servicesClose).toHaveBeenCalledTimes(1);
  expect(mocks.detach).toHaveBeenCalledTimes(1);
});

it("keeps session transfer history alive until its owning session closes", async () => {
  const session = await files.createSession!({ signal: new AbortController().signal });
  await act(async () => {
    mounted = await session.mount({ root, misty: sdk(), context });
  });
  await act(async () => {
    await mounted!.unmount();
  });
  expect(mocks.historyClose).not.toHaveBeenCalled();
  await session.close();
  expect(mocks.historyClose).toHaveBeenCalledTimes(1);
});
