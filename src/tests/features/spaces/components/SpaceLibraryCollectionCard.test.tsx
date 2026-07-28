import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Button } from "@/ui";
import { collectionCardClassName } from "@/features/spaces/components/SpaceLibraryCollections";

/**
 * Album and folder tiles are rendered with Button, whose base styles are built
 * for a control rather than a card: inline-flex with centred items,
 * whitespace-nowrap, and a fixed h-9. Left alone they collapse a tile into a
 * 36px pill with the icon and label side by side and the name clipped.
 *
 * collectionCardClassName exists solely to undo those defaults, so these tests
 * assert the overrides are present rather than re-testing Button.
 */
describe("collection card layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("lets a card grow to its content instead of Button's fixed height", () => {
    expect(collectionCardClassName).toContain("h-auto");
  });

  it("stacks the cover, name, and count vertically", () => {
    expect(collectionCardClassName).toContain("flex-col");
    // Without items-stretch the children centre themselves and the cover stops
    // filling the card width.
    expect(collectionCardClassName).toContain("items-stretch");
  });

  it("allows the name to wrap or truncate rather than forcing one line", () => {
    expect(collectionCardClassName).toContain("whitespace-normal");
  });

  it("survives Button's class merging in a real render", async () => {
    await act(async () =>
      root.render(
        <Button className={collectionCardClassName} type="button">
          <span className="block p-3">
            <span className="block truncate text-xs font-medium">Inspiration</span>
            <span className="mt-1 block text-[10px]">0 items</span>
          </span>
        </Button>,
      ),
    );

    const card = container.querySelector("button");
    expect(card).not.toBeNull();
    const className = card?.className ?? "";
    // tailwind-merge drops the losing side of a conflict, so these must be the
    // classes that actually survive, not merely the ones we asked for.
    expect(className).toContain("h-auto");
    expect(className).toContain("flex-col");
    expect(className).not.toContain("h-9");
    // The label must still be reachable, which it is not when the tile collapses.
    expect(card?.textContent).toContain("Inspiration");
  });
});
