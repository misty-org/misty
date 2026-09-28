import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CursorCompanionRoot } from "./CursorCompanionRoot";
import { cursorEvent, presentationEvent, type Presentation } from "./protocol";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  emitTo: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emitTo }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "misty-cursor-1",
    listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
      mocks.listeners.set(name, cb);
      return () => mocks.listeners.delete(name);
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.listeners.clear();
  mocks.invoke.mockReset();
  mocks.emitTo.mockReset();
});

it("renders activity fades while preserving explicit visibility and active feedback", async () => {
  let now = 0;
  let frame: FrameRequestCallback = () => {};
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  mocks.invoke.mockResolvedValue({
    generation: 1,
    visible: true,
    phase: "idle",
    mode: "team",
    model: "",
  });
  const { container } = render(<CursorCompanionRoot />);
  await act(async () => {});
  const group = container.querySelector<HTMLElement>(".cursor-group")!;
  const present = (visible: boolean, phase: Presentation["phase"] = "idle", error?: string) => {
    act(() =>
      mocks.listeners.get(presentationEvent)!({
        payload: {
          generation: 1,
          visible,
          phase,
          error,
          mode: "team",
          model: "",
        },
      }),
    );
  };
  const sample = (time: number, x: number, keyboardActivity = 0) => {
    now = time;
    act(() => {
      mocks.listeners.get(cursorEvent)!({
        payload: {
          x,
          y: 100,
          keyboardActivity,
          displays: [{ id: 1, x: 0, y: 0, width: 1000, height: 800, scale: 1 }],
        },
      });
      frame(now);
    });
  };
  expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_snapshot");
  // Startup must work without a subsequent presentation broadcast.
  sample(0, 100);
  expect(group.style.opacity).toBe("1");
  sample(3000, 100);
  expect(group.style.opacity).toBe("0");
  expect(group.style.transitionDuration).toBe("400ms");
  sample(3100, 120);
  expect(group.style.opacity).toBe("1");
  sample(3200, 120, 1);
  expect(group.style.opacity).toBe("0");
  expect(group.style.transitionDuration).toBe("150ms");
  for (const phase of ["listening", "processing", "responding"] as const) {
    present(true, phase);
    sample(3300, 120, 1);
    expect(group.style.opacity).toBe("1");
  }
  present(true, "idle", "Request failed");
  sample(10_000, 120, 2);
  expect(group.style.opacity).toBe("1");
  expect(container.querySelector(".cursor-error-bubble")?.textContent).toContain(
    "Open Agents to retry",
  );
  present(false, "idle", "Request failed");
  sample(11_000, 140, 2);
  expect(group.style.opacity).toBe("0");
});

it("reports snapshot failures instead of silently leaving the overlay hidden", async () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  mocks.invoke.mockRejectedValue("This view cannot invoke Host commands.");
  render(<CursorCompanionRoot />);
  await act(async () => {});
  expect(mocks.emitTo).toHaveBeenCalledWith("main", "misty://cursor-renderer-error", {
    error: expect.stringContaining("could not restore its display state"),
  });
});
