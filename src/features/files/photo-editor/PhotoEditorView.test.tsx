import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CropRect } from "@/shared/ui";
import type { ImageEdit } from "./imageEdit";

type StageProps = {
  edit: ImageEdit;
  mode: string;
  tool: string;
  cropDraft: CropRect | null;
  onCropDraft: (crop: CropRect) => void;
  textDraft: { text: string } | null;
};

const hoisted = vi.hoisted(() => ({
  stage: null as StageProps | null,
  canCut: false,
  removeBackground: vi.fn(async () => new Blob(["cut"], { type: "image/png" })),
}));

vi.mock("./ImageStage", () => ({
  ImageStage: (props: StageProps) => {
    hoisted.stage = props;
    return <div data-testid="stage" />;
  },
}));
vi.mock("./imageRender", async (original) => ({
  ...(await original<object>()),
  openPhoto: vi.fn(async () => ({ image: {}, width: 400, height: 300 })),
  decodedPhoto: () => undefined,
  workingCopy: (photo: unknown) => photo,
  renderPhoto: () => ({ canvas: { toDataURL: () => "data:image/jpeg;base64," }, drawn: {} }),
  renderFinal: () => ({}),
  renderEdit: async () => ({}),
  canvasToBlob: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
  autoAdjustments: () => ({ exposure: 12 }),
}));
vi.mock("./stickers", async (original) => ({
  ...(await original<object>()),
  stickerPreview: () => "data:image/png;base64,",
}));
vi.mock("./cutout", () => ({
  useCanRemoveBackground: () => hoisted.canCut,
  removeBackground: hoisted.removeBackground,
}));

import { PhotoEditorView } from "./PhotoEditorView";

const onClose = vi.fn();
const onSaveAsCopy = vi.fn(async () => undefined);

async function open(extra: Record<string, unknown> = {}) {
  render(
    <PhotoEditorView
      sourceKey="k"
      name="Beach.png"
      url="blob:beach"
      onClose={onClose}
      onSaveAsCopy={onSaveAsCopy}
      Error={() => null}
      {...extra}
    />,
  );
  await screen.findByRole("toolbar", { name: "View" });
}

const tab = (name: string) =>
  within(screen.getByRole("toolbar", { name: "Tools" })).getByRole("button", { name });
const stage = () => hoisted.stage!;

beforeEach(() => {
  hoisted.canCut = false;
  hoisted.stage = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the photo editor, in OpenCut's layout", () => {
  it("lays out the tools, the image and the image's details side by side", async () => {
    await open();
    const rail = within(screen.getByRole("toolbar", { name: "Tools" }));
    expect(rail.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Adjust",
      "Filters",
      "Crop",
      "Markup",
      "Text",
      "Stickers",
      "Size",
    ]);
    expect(tab("Adjust").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "Adjust" })).toBeTruthy();
    expect(screen.getByText("400 × 300 pixels")).toBeTruthy();
  });

  it("has an Agent tab where an agent can reach the image, and Remove background where it works", async () => {
    hoisted.canCut = true;
    await open({ agentPanel: <div>Chat about Beach</div> });
    fireEvent.click(tab("Agent"));
    expect(screen.getByText("Chat about Beach")).toBeTruthy();
    expect(tab("Remove background")).toBeTruthy();
  });

  it("changes the image from a panel, and Save shows once it has changed", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Save as copy" })).toBeNull();
    fireEvent.click(tab("Filters"));
    fireEvent.click(screen.getByRole("radio", { name: "Vivid" }));
    expect(stage().edit.filter).toBe("vivid");
    fireEvent.click(tab("Adjust"));
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(stage().edit.adjust.exposure).toBe(12);
    expect(screen.getByRole("button", { name: "Save as copy" })).toBeTruthy();
  });

  it("keeps the crop on leaving the Crop tab, and Escape leaves it as it was", async () => {
    await open();
    fireEvent.click(tab("Crop"));
    expect(stage().mode).toBe("crop");
    expect(stage().cropDraft).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    const half = { x: 0, y: 0, width: 0.5, height: 0.5 };
    act(() => stage().onCropDraft(half));
    fireEvent.click(tab("Adjust"));
    expect(stage().mode).toBe("view");
    expect(stage().edit.crop).toEqual(half);

    fireEvent.click(tab("Crop"));
    act(() => stage().onCropDraft({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(stage().mode).toBe("view");
    expect(stage().edit.crop).toEqual(half);
    expect(tab("Adjust").getAttribute("aria-pressed")).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("picks a markup tool by its letter, and Escape steps back to the pointer, then closes", async () => {
    await open();
    fireEvent.keyDown(document.body, { key: "p" });
    expect(tab("Markup").getAttribute("aria-pressed")).toBe("true");
    expect(stage().mode).toBe("markup");
    expect(stage().tool).toBe("pen");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(stage().tool).toBe("select");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("writes text from its own tab, which keeps it out of Markup's tools", async () => {
    await open();
    fireEvent.click(tab("Markup"));
    expect(screen.queryByRole("radio", { name: /^Text/ })).toBeNull();
    fireEvent.keyDown(document.body, { key: "t" });
    expect(tab("Text").getAttribute("aria-pressed")).toBe("true");
    expect(stage().mode).toBe("markup");
    expect(stage().tool).toBe("text");
    const panel = within(screen.getByRole("region", { name: "Text" }));
    fireEvent.click(panel.getByRole("button", { name: "Add text" }));
    expect(stage().textDraft?.text).toBe("");
  });

  it("puts a sticker on the image from the Stickers tab, picked to move and size", async () => {
    await open();
    fireEvent.click(tab("Stickers"));
    expect(stage().tool).toBe("select");
    const panel = within(screen.getByRole("region", { name: "Stickers" }));
    fireEvent.change(panel.getByRole("searchbox"), { target: { value: "France" } });
    fireEvent.click(panel.getByRole("button", { name: "France" }));
    const marks = Object.values(stage().edit.marks);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: "sticker", sticker: "flags:FR", opacity: 1 });
    expect(screen.getByRole("region", { name: "France" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Opacity" })).toBeTruthy();
  });

  it("saves in the format picked in the Size tab", async () => {
    const { canvasToBlob } = await import("./imageRender");
    await open();
    fireEvent.click(tab("Filters"));
    fireEvent.click(screen.getByRole("radio", { name: "Vivid" }));
    fireEvent.click(tab("Size"));
    expect(screen.getByRole("region", { name: "Size" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Format" }).textContent).toContain("PNG");
    expect(screen.queryByRole("slider", { name: "Quality" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save as copy" }));
    await waitFor(() => expect(onSaveAsCopy).toHaveBeenCalled());
    expect(canvasToBlob).toHaveBeenCalledWith(expect.anything(), "image/png", 0.92);
  });

  it("saves a copy of the image with only its subject", async () => {
    hoisted.canCut = true;
    await open();
    fireEvent.click(tab("Remove background"));
    const panel = within(screen.getByRole("region", { name: "Remove background" }));
    fireEvent.click(panel.getByRole("button", { name: "Remove background" }));
    await waitFor(() =>
      expect(onSaveAsCopy).toHaveBeenCalledWith(expect.any(Blob), "Beach (no background).png"),
    );
    expect(hoisted.removeBackground).toHaveBeenCalledWith(expect.any(Blob));
  });

  it("shows only the image to someone who can only view it", async () => {
    await open({ readonly: true });
    expect(screen.queryByRole("toolbar", { name: "Tools" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(stage().mode).toBe("view");
  });
});
