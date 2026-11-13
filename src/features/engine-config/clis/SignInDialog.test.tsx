import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignInStarted } from "./signInApi";

const api = vi.hoisted(() => ({
  start: vi.fn(),
  code: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  close: vi.fn(),
}));
const closed = vi.hoisted(() => ({ current: null as ((ok: boolean) => void) | null }));

vi.mock("./signInApi", () => ({
  signInApi: api,
  listenSignIn: vi.fn(async (_id: string, _data: unknown, onClosed: (ok: boolean) => void) => {
    closed.current = onClosed;
    return () => undefined;
  }),
}));

vi.mock("@/shared/lib/terminal/xtermLoader", () => ({
  loadXterm: async () => ({
    Terminal: class {
      cols = 80;
      rows = 24;
      loadAddon() {}
      open() {}
      write() {}
      onData() {}
      focus() {}
      dispose() {}
    },
    FitAddon: class {
      fit() {}
    },
  }),
}));

import { SignInDialog } from "./SignInDialog";

async function open(engine: string, started: SignInStarted, signOut = false, provider?: string) {
  api.start.mockResolvedValue(started);
  const onClose = vi.fn();
  await act(async () => {
    render(<SignInDialog request={{ engine, signOut, provider }} onClose={onClose} />);
  });
  return onClose;
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue(undefined);
  closed.current = null;
});

afterEach(() => cleanup());

describe("SignInDialog", () => {
  it("asks for the code in one field, with the terminal folded away", async () => {
    await open("claude", { command: "claude auth login", asks: "code" });
    expect(screen.getByText(/A Claude page opens in your browser/)).toBeTruthy();
    expect(screen.getByLabelText("Code")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show details" })).toBeTruthy();
    // The line that runs sits in the folded details.
    expect(screen.getByText("claude auth login").closest('[data-state="closed"]')).not.toBeNull();
  });

  it("types the pasted code into the sign-in's terminal and clears the field", async () => {
    await open("agy", { command: "agy --print", asks: "code" });
    const field = screen.getByLabelText("Code") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "  4/0AbC-123 \n" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    const id = api.start.mock.calls[0]![1] as string;
    expect(api.code).toHaveBeenCalledWith(id, "4/0AbC-123");
    expect(api.write).not.toHaveBeenCalled();
    expect(field.value).toBe("");
    expect(screen.getByText(/Signing you in to Antigravity/)).toBeTruthy();
  });

  it("shows what went wrong next to the field", async () => {
    await open("claude", { command: "claude auth login", asks: "code" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    const field = screen.getByLabelText("Code");
    expect(api.code).not.toHaveBeenCalled();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(field.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Paste the code first.",
    );

    api.code.mockRejectedValue(new Error("That sign-in has ended. Close this and try again."));
    fireEvent.change(field, { target: { value: "abc" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(document.getElementById(field.getAttribute("aria-describedby")!)?.textContent).toBe(
      "That sign-in has ended. Close this and try again.",
    );
  });

  it("points a menu sign-in at the folded terminal, with no code field", async () => {
    const onClose = await open("gemini", { command: "gemini, then /auth", asks: "menu" });
    expect(screen.getByText(/asks how you'd like to sign in. Open Show details/)).toBeTruthy();
    expect(screen.queryByLabelText("Code")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("gemini, then /auth").closest('[data-state="closed"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Hide details" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    // Done says the person finished in the CLI's own screen.
    const id = api.start.mock.calls[0]![1] as string;
    expect(api.close).toHaveBeenCalledWith(id, true);
    expect(onClose).toHaveBeenCalled();
  });

  it("says what to do on the page for a direct sign-in, with no code field", async () => {
    const onClose = await open("gemini", { command: "gemini --prompt", asks: "nothing" });
    expect(screen.getByText(/A Google page opens in your browser/)).toBeTruthy();
    expect(screen.queryByLabelText("Code")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(api.close).not.toHaveBeenCalledWith(expect.anything(), true);
  });

  it("names the provider picked for Pi, and points a device code at the details", async () => {
    await open("pi", { command: "pi auth login anthropic", asks: "nothing" }, false, "anthropic");
    expect(screen.getByText(/A sign-in page for Claude Pro \/ Max opens/)).toBeTruthy();
    cleanup();
    await open("pi", { command: "pi auth login", asks: "device-code" }, false, "github-copilot");
    expect(
      screen.getByText(/A GitHub page opens in your browser and asks for a code/),
    ).toBeTruthy();
  });

  it("says plainly how it ended and drops the field", async () => {
    await open("claude", { command: "claude auth login", asks: "code" });
    await act(async () => closed.current?.(true));
    expect(screen.getByText("You're signed in to Claude Code.")).toBeTruthy();
    expect(screen.queryByLabelText("Code")).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("shows a sign-in that couldn't start in place of the steps", async () => {
    api.start.mockRejectedValue(new Error("Claude Code could not be started: not found"));
    await act(async () => {
      render(<SignInDialog request={{ engine: "claude" }} onClose={() => undefined} />);
    });
    expect(
      screen.getAllByText("Claude Code could not be started: not found").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Code")).toBeNull();
  });
});
