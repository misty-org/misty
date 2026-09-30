import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnlockDialogModel } from "@/api/spaces/dto/types/SpaceLibraryDialogs";
import { UnlockDialog } from "./UnlockDialog";

describe("library lock dialog", () => {
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
  async function render(configured: boolean | null) {
    const model: UnlockDialogModel = {
      scope: "hidden",
      configured,
      password: "",
      confirmation: "",
      saving: false,
      error: "",
      setPassword: vi.fn(),
      setConfirmation: vi.fn(),
      close: vi.fn(),
      submit: vi.fn(),
    };
    await act(async () => root.render(<UnlockDialog model={model} />));
    return document.querySelector('[role="dialog"]')!;
  }
  it("requires setting and confirming a separate password on first use", async () => {
    const dialog = await render(false);
    expect(dialog.textContent).toContain("Set your library password");
    expect(dialog.textContent).toContain("does not change how you sign in");
    expect(dialog.querySelectorAll('input[type="password"]')).toHaveLength(2);
    expect(dialog.textContent).not.toContain("Google");
    expect(dialog.querySelectorAll('input[autocomplete="new-password"]')).toHaveLength(2);
  });
  it("asks only for the library password after setup", async () => {
    const dialog = await render(true);
    expect(dialog.textContent).toContain("Enter your library password");
    expect(dialog.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(dialog.textContent).not.toContain("Google");
    expect(dialog.textContent).not.toContain("Misty password");
  });
  it("cannot unlock before the setup status is known", async () => {
    const dialog = await render(null);
    expect(dialog.textContent).toContain("Checking library lock");
    expect((dialog.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
