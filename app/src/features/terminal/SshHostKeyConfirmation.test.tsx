import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SshHostKeyConfirmation } from "./SshHostKeyConfirmation";

describe("SshHostKeyConfirmation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows the fingerprint and requires an explicit choice", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    await act(async () => {
      root.render(
        <SshHostKeyConfirmation
          status={{
            state: "confirmation_required",
            fingerprints: ["SHA256:verified-host-key"],
            message: "Confirm this host fingerprint before Misty connects.",
          }}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );
    });

    expect(container.textContent).toContain("SHA256:verified-host-key");
    expect(container.textContent).toContain("Compare this fingerprint");
    await click(buttonNamed(container, "Trust and connect"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttonNamed(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  )!;
}
