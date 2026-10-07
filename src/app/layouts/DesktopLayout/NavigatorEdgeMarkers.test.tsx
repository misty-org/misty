import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NavigatorEdgeMarkers } from "./NavigatorEdgeMarkers";
import type { DockPosition } from "@/features/app-shell/dockingLayout";

function Fixture({
  position = "left",
  generic = false,
}: {
  position?: DockPosition;
  generic?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  return (
    <nav ref={ref}>
      <div style={{ overflowY: "auto" }} data-scroll="true">
        <button data-navigation-destination aria-current="page">
          Files
        </button>
        <button
          data-spaces-toggle={generic ? undefined : true}
          data-navigator-toggle={generic ? true : undefined}
          data-active="true"
          aria-expanded="true"
        >
          Spaces
        </button>
        <div data-spaces-stack>
          <button data-navigation-destination aria-current="page">
            Family
          </button>
        </div>
      </div>
      <div data-navigator-profile-bar="fixed">
        <button aria-expanded="true">Activity</button>
        <button data-state="open">Sync</button>
        <button>Search</button>
        <button data-navigation-destination aria-pressed="true">
          Settings
        </button>
        <button aria-label="Profile" aria-expanded="true">
          Profile
        </button>
      </div>
      <button>Create Space</button>
      <NavigatorEdgeMarkers navigatorRef={ref} position={position} />
    </nav>
  );
}
const markers = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".misty-navigator-edge-marker"));
let offset = 0;
beforeEach(() => {
  offset = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const button = this.tagName === "BUTTON";
    const top = button ? (this.textContent === "Family" ? 200 : 100) + offset : 0;
    return {
      x: 12,
      y: top,
      left: 12,
      top,
      right: 48,
      bottom: top + (button ? 32 : 400),
      width: 36,
      height: button ? 32 : 400,
      toJSON: () => ({}),
    };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["left", "right", "top", "bottom"] as const)(
  "excludes active utility controls from the %s edge",
  (position) => {
    render(<Fixture position={position} />);
    expect(markers()).toHaveLength(3);
    expect(screen.getByRole("navigation").contains(markers()[0])).toBe(false);
    expect(markers()[0].dataset).toMatchObject({ edge: position, state: "active" });
    expect(markers()[1].dataset.state).toBe("hidden");
    expect(markers()[2].dataset.state).toBe("active");
  },
);

it.each([false, true])(
  "moves the active marker to a collapsed tray (generic: %s)",
  async (generic) => {
    render(<Fixture generic={generic} />);
    act(() => {
      screen.getByRole("button", { name: "Spaces" }).setAttribute("aria-expanded", "false");
      screen.getByRole("button", { name: "Family" }).parentElement!.setAttribute("inert", "");
    });
    await waitFor(() => expect(markers()[1].dataset.state).toBe("active"));
    expect(markers()[2].dataset.state).toBe("hidden");
  },
);

it("tracks scroll position and hides markers whose source is clipped", async () => {
  render(<Fixture />);
  offset = -50;
  fireEvent.scroll(document.querySelector("[data-scroll]")!);
  await waitFor(() => expect(markers()[0].style.top).toBe("66px"));
  offset = -300;
  fireEvent.scroll(document.querySelector("[data-scroll]")!);
  await waitFor(() => expect(markers()[0].dataset.state).toBe("hidden"));
});

it("uses the horizontal center for a dock at the window's bottom edge", () => {
  render(<Fixture position="bottom" />);
  expect(markers()[0].dataset.edge).toBe("bottom");
  expect(markers()[0].style.left).toBe("30px");
  expect(markers()[0].style.top).toBe("");
});
