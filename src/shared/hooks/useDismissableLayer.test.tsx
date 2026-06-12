import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useDismissableLayer } from "./useDismissableLayer";

function TestLayer(props: { active: boolean; onDismiss: () => void }) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  useDismissableLayer({ active: props.active, layerRef, onDismiss: props.onDismiss });
  return (
    <>
      <div ref={layerRef} data-testid="layer">
        <button type="button">Inside</button>
      </div>
      <button type="button" data-testid="outside">
        Outside
      </button>
    </>
  );
}

describe("useDismissableLayer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("dismisses on an outside pointer-down and Escape regardless of focus", async () => {
    const onDismiss = vi.fn();
    await act(async () => root.render(<TestLayer active onDismiss={onDismiss} />));

    const inside = container.querySelector("[data-testid='layer'] button")!;
    const outside = container.querySelector<HTMLButtonElement>("[data-testid='outside']")!;
    inside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    outside.focus();
    outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
