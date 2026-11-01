import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suspend: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  browseOnly: vi.fn().mockResolvedValue(undefined),
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
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../setup/useServerSwitch", () => ({
  useServerSwitch: () => ({ switchTo: vi.fn(), browseOnly: mocks.browseOnly }),
}));

import { useServerChoice } from "@/api/deployment/serverChoice";
import { SignInSheet as Sheet } from "./SignInSheet";
import { openSignInSheet, signInReasonCopy, useSignInSheetStore } from "./signInSheetStore";
import { openSignOutSheet, SignOutSheet } from "./SignOutSheet";

function SignInSheet(): ReactNode {
  return (
    <MemoryRouter>
      <Sheet />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useSignInSheetStore.getState().close();
  // A development build talks to its local stack until a server is chosen.
  useServerChoice.setState({ loaded: true, choice: null });
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

it("starts by choosing a server when this device has none", () => {
  useServerChoice.setState({ loaded: true, choice: { mode: "none" } });
  render(<SignInSheet />);
  act(() => openSignInSheet("sync"));
  expect(screen.getByRole("dialog", { name: signInReasonCopy.sync.title })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Misty Cloud/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /My own server/ }));
  expect(screen.getByRole("dialog", { name: "Your own server" })).toBeTruthy();
  expect(screen.getByLabelText("Server address")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: /Misty Cloud/ }));
  expect(screen.getByLabelText("Setup link")).toBeTruthy();
});

it("is the setup wizard, where Just browse leaves Misty without a server", async () => {
  render(<SignInSheet />);
  act(() => openSignInSheet("setup"));
  expect(screen.getByRole("dialog", { name: "Set up Misty" })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Just browse/ })));
  expect(mocks.browseOnly).toHaveBeenCalled();
  expect(useSignInSheetStore.getState().reason).toBeNull();
});

it("asks for the setup key when only the server's address is pasted", () => {
  useServerChoice.setState({ loaded: true, choice: { mode: "none" } });
  render(<SignInSheet />);
  act(() => openSignInSheet("setup"));
  fireEvent.click(screen.getByRole("button", { name: /Misty Cloud/ }));
  const continueButton = () =>
    screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
  expect(continueButton().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Setup link"), {
    target: { value: "cloud.misty.example" },
  });
  expect(screen.getByLabelText("Setup key")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Setup key"), {
    target: { value: "misty_setup_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" },
  });
  expect(continueButton().disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Setup link"), {
    target: {
      value: "https://cloud.misty.example/setup#key=misty_setup_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    },
  });
  expect(screen.queryByLabelText("Setup key")).toBeNull();
  expect(continueButton().disabled).toBe(false);
});
