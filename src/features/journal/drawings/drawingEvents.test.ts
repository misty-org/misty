import { describe, expect, it, vi } from "vitest";
import { notifyDrawingListChanged, subscribeToDrawingListChanges } from "./drawingEvents";

describe("drawing list events", () => {
  it("observes local and realtime changes for the selected Space", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDrawingListChanges("space_1", listener);

    notifyDrawingListChanged("space_1");
    notifyDrawingListChanged("space_other");
    window.dispatchEvent(
      new CustomEvent("misty:space-drawing-event", {
        detail: { space_id: "space_1", type: "drawing.created" },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("misty:space-drawing-event", {
        detail: { space_id: "space_other", type: "drawing.updated" },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    notifyDrawingListChanged("space_1");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
