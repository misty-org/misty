import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MistyComposer } from "./MistyComposer";
import type { MistyImageAttachment } from "./types";

afterEach(cleanup);

const attachment: MistyImageAttachment = {
  id: "aiatt-1",
  name: "reference.png",
  mimeType: "image/png",
  byteSize: 20,
  width: 10,
  height: 10,
  previewUrl: "blob:reference",
  state: "ready",
};

describe("MistyComposer", () => {
  it("enforces the visual Search limit and hides model controls", () => {
    const onError = vi.fn();
    render(
      <MistyComposer
        value=""
        onChange={() => undefined}
        mode="search"
        attachments={[attachment]}
        maxAttachments={1}
        onAddFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onSubmit={vi.fn()}
        onError={onError}
        modelControl={<span>Model control</span>}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: { files: [new File(["image"], "second.png", { type: "image/png" })] },
    });
    expect(onError).toHaveBeenCalledWith("Misty accepts up to 1 image here.");
    expect(screen.queryByText("Model control")).toBeNull();
  });

  it("renders modelControl on the left without a static Ask badge in ask mode", () => {
    render(
      <MistyComposer
        value=""
        onChange={() => undefined}
        mode="ask"
        attachments={[]}
        maxAttachments={10}
        onAddFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onSubmit={vi.fn()}
        modelControl={<span data-testid="model-control">GPT 5.6 Terra</span>}
      />,
    );
    expect(screen.getByTestId("model-control")).toBeDefined();
    expect(screen.queryByText("Ask")).toBeNull();
  });
});
