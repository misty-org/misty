import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ReactRouterDom from "react-router-dom";

const mocks = vi.hoisted(() => ({
  load: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
  pushNotification: vi.fn(),
  uploadLibraryPath: vi.fn(),
  spaces: [
    {
      id: "space-allowed",
      name: "Launch room",
      is_shared: true,
      permissions: { "library.upload": true },
    },
    {
      id: "space-blocked",
      name: "Read-only room",
      is_shared: true,
      permissions: { "library.upload": false },
    },
  ],
}));

vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof ReactRouterDom>("react-router-dom")),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/features/files/explorer", () => ({
  useExplorerStore: {
    getState: () => ({ pushNotification: mocks.pushNotification }),
  },
}));

vi.mock("@/api/spaces/api", () => ({
  spacesApi: { uploadLibraryPath: mocks.uploadLibraryPath },
}));

vi.mock("../../store/useSpacesStore", () => ({
  useSpacesStore: (selector: (state: unknown) => unknown) =>
    selector({ spaces: mocks.spaces, loading: false, load: mocks.load }),
}));

// The dialog behavior is under test, not Radix Select's portal and pointer mechanics.
// This keeps the test deterministic in jsdom while preserving the component contract.
vi.mock("@/shared/ui", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Badge: Wrapper,
    Button: ({ children, variant: _variant, ...props }: Record<string, unknown>) => (
      <button {...props}>{children as ReactNode}</button>
    ),
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <>{children}</> : null,
    DialogContent: Wrapper,
    DialogDescription: Wrapper,
    DialogFooter: Wrapper,
    DialogHeader: Wrapper,
    DialogTitle: Wrapper,
    Progress: ({ value, ...props }: { value: number; [key: string]: unknown }) => (
      <div role="progressbar" aria-valuenow={value} {...props} />
    ),
    Select: ({
      children,
      disabled,
      onValueChange,
    }: {
      children?: ReactNode;
      disabled?: boolean;
      onValueChange: (value: string) => void;
    }) => (
      <div>
        {children}
        <button
          type="button"
          data-testid="choose-destination"
          disabled={disabled}
          onClick={() => onValueChange("space-allowed")}
        >
          Choose Launch room
        </button>
      </div>
    ),
    SelectContent: Wrapper,
    SelectItem: ({ children, value: _value }: { children?: ReactNode; value: string }) => (
      <span>{children}</span>
    ),
    SelectTrigger: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: ReactNode }) => <span>{placeholder}</span>,
  };
});

import { AddFilesToSpaceDialog } from "@/features/spaces/library";

describe("AddFilesToSpaceDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.load.mockClear();
    mocks.navigate.mockClear();
    mocks.pushNotification.mockClear();
    mocks.uploadLibraryPath.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("states copy semantics and excludes Spaces without upload permission", async () => {
    await renderDialog(root, ["/Users/misty/report.pdf"]);

    expect(container.textContent).toContain("Your originals stay in Files");
    expect(container.textContent).toContain("never moved or replaced");
    expect(container.textContent).toContain("Launch room");
    expect(container.textContent).not.toContain("Read-only room");
    expect(container.textContent).toContain("report.pdf");
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it("uploads at most two copies concurrently and opens the destination Library", async () => {
    const paths = ["/local/one.txt", "/local/two.txt", "/local/three.txt"];
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    mocks.uploadLibraryPath.mockImplementation(
      async (
        _spaceId: string,
        _path: string,
        _kind: string,
        options: { onStage: (stage: string) => void; onProgress: (value: number) => void },
      ) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        options.onStage("uploading");
        options.onProgress(0.5);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      },
    );
    const libraryEvent = vi.fn();
    window.addEventListener("misty:space-library-event", libraryEvent);

    await renderDialog(root, paths);
    await chooseDestination();
    await clickButton("Add copies", false);

    expect(mocks.uploadLibraryPath).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(2);

    await act(async () => {
      releases.shift()?.();
      await Promise.resolve();
    });
    expect(mocks.uploadLibraryPath).toHaveBeenCalledTimes(3);

    await act(async () => {
      releases.splice(0).forEach((release) => release());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(maxActive).toBe(2);
    expect(
      mocks.uploadLibraryPath.mock.calls.map(([spaceId, path, kind]) => ({ spaceId, path, kind })),
    ).toEqual(paths.map((path) => ({ spaceId: "space-allowed", path, kind: "library" })));
    for (const call of mocks.uploadLibraryPath.mock.calls) {
      expect(call[3]).toMatchObject({
        signal: expect.any(AbortSignal),
        onStage: expect.any(Function),
        onProgress: expect.any(Function),
      });
    }
    expect(mocks.pushNotification).toHaveBeenCalledWith(
      "3 copies added to Launch room.",
      "success",
      5000,
    );
    expect(libraryEvent).toHaveBeenCalledOnce();
    expect((libraryEvent.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      space_id: "space-allowed",
    });
    expect(container.textContent).toContain("3 copies added to Launch room.");

    await clickButton("View Library");
    expect(mocks.navigate).toHaveBeenCalledWith("/spaces/space-allowed/library");
    window.removeEventListener("misty:space-library-event", libraryEvent);
  });

  it("retries only the failed copies", async () => {
    mocks.uploadLibraryPath
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await renderDialog(root, ["/local/failed.txt", "/local/ready.txt"]);
    await chooseDestination();
    await clickButton("Add copies");

    expect(container.textContent).toContain("1 added to Launch room; 1 failed.");
    expect(container.textContent).toContain("Network unavailable");

    await clickButton("Retry failed");

    expect(mocks.uploadLibraryPath).toHaveBeenCalledTimes(3);
    expect(mocks.uploadLibraryPath.mock.calls[2]?.[1]).toBe("/local/failed.txt");
    expect(container.textContent).toContain("1 copy added to Launch room.");
  });
});

async function renderDialog(root: Root, paths: string[]) {
  await act(async () => {
    root.render(<AddFilesToSpaceDialog open paths={paths} onOpenChange={vi.fn()} />);
    await Promise.resolve();
  });
}

async function chooseDestination() {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="choose-destination"]');
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}

async function clickButton(label: string, flush = true) {
  const button = [...document.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  expect(button).not.toBeUndefined();
  await act(async () => {
    button!.click();
    if (flush) {
      await Promise.resolve();
      await Promise.resolve();
    }
  });
}
