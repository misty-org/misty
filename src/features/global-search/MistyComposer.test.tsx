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
  it("opens screen capture from the attachment menu", async () => {
    const capture = vi.fn();
    render(
      <MistyComposer
        value=""
        onChange={vi.fn()}
        mode="ask"
        attachments={[]}
        maxAttachments={10}
        onAddFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onSubmit={vi.fn()}
        onCapture={capture}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Add attachments" }), {
      button: 0,
      pointerType: "mouse",
    });
    expect(await screen.findByRole("menuitem", { name: "Attach files" })).toBeDefined();
    fireEvent.click(screen.getByRole("menuitem", { name: "Capture part of the screen" }));
    expect(capture).toHaveBeenCalledOnce();
  });
});

it("replaces the send action with stop while a conversation is working", () => {
  const stop = vi.fn();
  render(
    <MistyComposer
      layout="conversation"
      value=""
      onChange={vi.fn()}
      mode="ask"
      attachments={[]}
      maxAttachments={4}
      onAddFiles={vi.fn()}
      onRemoveAttachment={vi.fn()}
      onSubmit={vi.fn()}
      busy
      trailingControl={<button onClick={stop}>Stop response</button>}
    />,
  );
  expect(screen.queryByRole("button", { name: "Send to Misty" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Stop response" }));
  expect(stop).toHaveBeenCalledOnce();
});

it("disables the message field and ignores pasted files when unavailable", () => {
  const addFiles = vi.fn();
  render(
    <MistyComposer
      layout="conversation"
      value=""
      onChange={vi.fn()}
      mode="ask"
      attachments={[]}
      maxAttachments={4}
      onAddFiles={addFiles}
      onRemoveAttachment={vi.fn()}
      onSubmit={vi.fn()}
      disabled
    />,
  );
  expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.paste(document.querySelector("[data-misty-universal-composer]")!, {
    clipboardData: { files: [new File(["image"], "image.png", { type: "image/png" })] },
  });
  expect(addFiles).not.toHaveBeenCalled();
});
