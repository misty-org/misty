import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  label: "misty-desktop-island",
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: mocks.label,
    listen: (name: string, handler: (event: { payload: unknown }) => void) => {
      mocks.listeners.set(name, handler);
      return Promise.resolve(() => mocks.listeners.delete(name));
    },
  }),
}));

import { DesktopOverlayRoot } from "./DesktopOverlayRoot";

afterEach(cleanup);

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) =>
    Promise.resolve(
      command === "agent_desktop_overlay_state"
        ? { status: "Opening Settings", meta: "", waiting: false }
        : null,
    ),
  );
  mocks.listeners.clear();
  mocks.label = "misty-desktop-island";
});

it("sends the person's presses through Misty, never empty messages", async () => {
  render(<DesktopOverlayRoot />);
  expect(await screen.findByText("Opening Settings")).toBeTruthy();
  fireEvent.click(screen.getByText("Send"));
  expect(mocks.invoke).not.toHaveBeenCalledWith("agent_desktop_island_press", expect.anything());
  fireEvent.change(screen.getByLabelText("Message for Misty"), {
    target: { value: " use dark mode " },
  });
  fireEvent.click(screen.getByText("Send"));
  expect(mocks.invoke).toHaveBeenCalledWith("agent_desktop_island_press", {
    action: "send",
    text: "use dark mode",
  });
  fireEvent.click(screen.getByText("Stop"));
  expect(mocks.invoke).toHaveBeenCalledWith("agent_desktop_island_press", {
    action: "stop",
    text: "",
  });
});

it("offers only Done and Stop while the task waits for the person", async () => {
  render(<DesktopOverlayRoot />);
  await screen.findByText("Opening Settings");
  act(() =>
    mocks.listeners.get("misty://desktop-island")?.({
      payload: { status: "Sign in, then press Done", meta: "", waiting: true },
    }),
  );
  expect(screen.getByText("Done")).toBeTruthy();
  expect(screen.queryByText("Take over")).toBeNull();
  expect(screen.queryByLabelText("Message for Misty")).toBeNull();
});

it("draws Misty's pointer where the agent acts", async () => {
  mocks.label = "misty-desktop-mist";
  mocks.invoke.mockResolvedValue({ waiting: false });
  const { container } = render(<DesktopOverlayRoot />);
  await act(async () => {});
  act(() => mocks.listeners.get("misty://desktop-pointer")?.({ payload: { x: 40, y: 50 } }));
  const pointer = container.querySelector<SVGElement>(".desktop-pointer");
  expect(pointer?.style.left).toBe("38px");
  act(() => mocks.listeners.get("misty://desktop-pointer")?.({ payload: null }));
  expect(container.querySelector(".desktop-pointer")).toBeNull();
});
