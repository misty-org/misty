import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suspend: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/webviews/browserRuntime", () => ({
  setBrowserWebviewsSuspended: mocks.suspend,
}));
vi.mock("../AuthContext", () => ({ useAuth: () => ({ logout: mocks.logout }) }));
vi.mock("../components/SignInForm", () => ({
  default: () => <form aria-label="Sign in form" />,
}));
vi.mock("../components/RegisterForm", () => ({
  default: () => <form aria-label="Create account form" />,
}));
vi.mock("../components/ForgotPasswordForm", () => ({ default: () => null }));

import { SignInSheet } from "./SignInSheet";
import { openSignInSheet, signInReasonCopy, useSignInSheetStore } from "./signInSheetStore";
import { openSignOutSheet, SignOutSheet } from "./SignOutSheet";

beforeEach(() => {
  useSignInSheetStore.getState().close();
  vi.clearAllMocks();
});
afterEach(cleanup);

it.each(["account", "sync", "space", "invite", "agents"] as const)(
  "says what asked for an account: %s",
  (reason) => {
    render(<SignInSheet />);
    act(() => openSignInSheet(reason));
    expect(screen.getByRole("dialog", { name: signInReasonCopy[reason].title })).toBeTruthy();
    expect(screen.getByText(signInReasonCopy[reason].description)).toBeTruthy();
    expect(screen.getByRole("form", { name: "Sign in form" })).toBeTruthy();
  },
);

it("goes back to the page with Not now, hiding page views only while open", () => {
  render(<SignInSheet />);
  act(() => openSignInSheet("sync"));
  expect(mocks.suspend).toHaveBeenLastCalledWith(true, "sign-in-sheet");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useSignInSheetStore.getState().reason).toBeNull();
  expect(mocks.suspend).toHaveBeenLastCalledWith(false, "sign-in-sheet");
});

it("offers creating an account in the same sheet", () => {
  render(<SignInSheet />);
  act(() => openSignInSheet("space"));
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(screen.getByRole("dialog", { name: "Create an account" })).toBeTruthy();
  expect(screen.getByRole("form", { name: "Create account form" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Sign in instead" }));
  expect(screen.getByRole("form", { name: "Sign in form" })).toBeTruthy();
});

it("signs out keeping browsing data unless removing it is chosen", async () => {
  render(<SignOutSheet />);
  act(() => openSignOutSheet());
  expect(screen.getByRole("dialog", { name: "Sign out of Misty?" })).toBeTruthy();
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign out" })));
  expect(mocks.logout).toHaveBeenLastCalledWith({ removeData: false });

  act(() => openSignOutSheet());
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign out" })));
  expect(mocks.logout).toHaveBeenLastCalledWith({ removeData: true });
});
