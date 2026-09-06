import { afterEach, describe, expect, it, vi } from "vitest";
import { refinePoint, snapPoint } from "./companionSharpen";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), apiRequest: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/api/client", () => ({ apiRequest: mocks.apiRequest }));
afterEach(() => {
  mocks.invoke.mockReset();
  mocks.apiRequest.mockReset();
  vi.useRealTimers();
});

const estimate = { x: 500, y: 300, displayId: 2, label: "click Commit" };

describe("snapPoint", () => {
  it("centers on the control Accessibility found", async () => {
    mocks.invoke.mockResolvedValue({
      x: 510,
      y: 296,
      frame: { x: 480, y: 286, width: 60, height: 20 },
    });
    await expect(snapPoint(estimate)).resolves.toEqual({
      ...estimate,
      x: 510,
      y: 296,
      frame: { x: 480, y: 286, width: 60, height: 20 },
    });
  });
  it("keeps the estimate when nothing fits, Accessibility fails, or it is slow", async () => {
    mocks.invoke.mockResolvedValueOnce(null);
    await expect(snapPoint(estimate)).resolves.toBeUndefined();
    mocks.invoke.mockRejectedValueOnce(new Error("no access"));
    await expect(snapPoint(estimate)).resolves.toBeUndefined();
    vi.useFakeTimers();
    mocks.invoke.mockReturnValueOnce(new Promise(() => {}));
    const slow = snapPoint(estimate);
    await vi.advanceTimersByTimeAsync(800);
    await expect(slow).resolves.toBeUndefined();
  });
});

describe("refinePoint", () => {
  it("maps the model's spot in a Retina crop back to display points", async () => {
    mocks.invoke.mockResolvedValue({
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA==",
      width: 560,
      height: 560,
      region: { x: 360, y: 160, width: 280, height: 280 },
    });
    mocks.apiRequest.mockResolvedValue({ found: true, x: 300, y: 260 });
    await expect(refinePoint(estimate, "invocation_1", 4)).resolves.toEqual({
      ...estimate,
      x: 510,
      y: 290,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture_region", {
      turn: 4,
      displayId: 2,
      x: 500,
      y: 300,
      size: 280,
    });
    const [path, init] = mocks.apiRequest.mock.calls[0];
    expect(path).toBe("/me/companion/refine-point/invocation_1");
    expect(JSON.parse(init.body)).toEqual({
      image: {
        mime_type: "image/jpeg",
        data_url: "data:image/jpeg;base64,AA==",
        width: 560,
        height: 560,
      },
      label: "click Commit",
      hint: { x: 280, y: 280 },
    });
  });
  it("leaves the point alone when the model cannot see it or there is no label", async () => {
    mocks.invoke.mockResolvedValue({
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA==",
      width: 280,
      height: 280,
      region: { x: 360, y: 160, width: 280, height: 280 },
    });
    mocks.apiRequest.mockResolvedValue({ found: false, x: 0, y: 0 });
    await expect(refinePoint(estimate, "invocation_1", 4)).resolves.toBeUndefined();
    await expect(
      refinePoint({ ...estimate, label: " " }, "invocation_1", 4),
    ).resolves.toBeUndefined();
    expect(mocks.apiRequest).toHaveBeenCalledOnce();
  });
});
