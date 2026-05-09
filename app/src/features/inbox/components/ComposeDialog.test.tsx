import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposeDialog } from "./ComposeDialog";

describe("Compose dialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("does not send until the person confirms", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onSave = vi.fn().mockResolvedValue({
      provider: "gmail",
      provider_id: "draft-1",
      account_id: "google-1",
      message: {},
    });
    await act(async () => {
      root.render(
        <ComposeDialog
          open
          accounts={[
            {
              connection_id: "connection-1",
              provider: "google",
              account_id: "google-1",
              email: "alex@example.com",
              display_name: "Alex",
              total: 0,
              unread: 0,
            },
          ]}
          replyTo={null}
          onOpenChange={vi.fn()}
          onSave={onSave}
          onSend={onSend}
        />,
      );
    });
    const inputs = [...document.querySelectorAll<HTMLInputElement>("input")];
    await act(async () => {
      setInput(inputs[0]!, "recipient@example.com");
      setInput(inputs[1]!, "Hello");
    });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Review send")
        ?.click();
    });

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Send this email?");

    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Send email")
        ?.click();
    });
    expect(onSend).toHaveBeenCalledWith("draft-1", "connection-1");
  });
});

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
