import "@/app/featureSeams";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suspend: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  switchToMistyCloud: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/app-windows/page-runtime/browserOverlayRuntime", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
  useServerSwitch: () => ({
    moveTo: vi.fn(),
    switchTo: vi.fn(),
    switchToMistyCloud: mocks.switchToMistyCloud,
  }),
}));

import { useServerChoice } from "@/api/deployment/serverChoice";
import { NoticeViewport } from "@/shared/ui";
import { SignInSheet as Sheet } from "./SignInSheet";
import { openSignInSheet, useSignInSheetStore } from "./signInSheetStore";
import { openSignOutSheet, SignOutSheet } from "./SignOutSheet";

let where: ReturnType<typeof useLocation>;
function Where(): ReactNode {
  where = useLocation();
  return null;
}

function SignInSheet(): ReactNode {
  return (
    <MemoryRouter initialEntries={["/browser/page"]}>
      <Sheet />
      <Where />
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

it.each(["sync", "space", "invite", "agents"] as const)(
  "goes to the welcome pages when an account is asked for: %s",
  (reason) => {
    render(<SignInSheet />);
    act(() => openSignInSheet(reason));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useSignInSheetStore.getState().reason).toBeNull();
    expect(where.pathname).toBe("/welcome");
    expect(where.state).toEqual({ from: "/browser/page", addingAccount: true });
  },
);

it("goes straight to sign-in from a Sign in button", () => {
  render(<SignInSheet />);
  act(() => openSignInSheet("account"));
  expect(where.pathname).toBe("/signin");
  expect(where.state).toEqual({ from: "/browser/page", addingAccount: true });
});

it("goes straight to sign-in for an expired session, with its email", () => {
  render(<SignInSheet />);
  act(() => openSignInSheet("expired", "person@example.com"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(where.pathname).toBe("/signin");
  expect(where.state).toEqual({
    from: "/browser/page",
    addingAccount: true,
    reauthenticateEmail: "person@example.com",
  });
});

it("goes back to the page with Not now, hiding page views only while open", () => {
  render(<SignInSheet />);
  act(() => openSignInSheet("setup"));
  expect(mocks.suspend).toHaveBeenLastCalledWith(true, "sign-in-sheet");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useSignInSheetStore.getState().reason).toBeNull();
  expect(mocks.suspend).toHaveBeenLastCalledWith(false, "sign-in-sheet");
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

it("starts by choosing a server when this device has none", async () => {
  useServerChoice.setState({ loaded: true, choice: { mode: "none" } });
  render(<SignInSheet />);
  act(() => openSignInSheet("setup"));
  expect(screen.getByRole("dialog", { name: "Set up Misty" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Misty Cloud/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Self-hosted/ }));
  expect(screen.getByRole("dialog", { name: "Your own server" })).toBeTruthy();
  expect(screen.getByLabelText("Server address")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: "Use a sign-in link" }));
  expect(screen.getByLabelText("Sign-in link")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Misty Cloud/ })));
  expect(mocks.switchToMistyCloud).toHaveBeenCalled();
  expect(screen.getByRole("form", { name: "Sign in form" })).toBeTruthy();
});

it("stays on choosing a server when Misty Pro can't be reached", async () => {
  mocks.switchToMistyCloud.mockRejectedValueOnce(new Error("Misty couldn't reach Misty Pro."));
  render(
    <>
      <NoticeViewport />
      <SignInSheet />
    </>,
  );
  act(() => openSignInSheet("setup"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Misty Cloud/ })));
  expect((await screen.findByRole("alert")).textContent).toContain("couldn't reach Misty Pro");
  expect(screen.getByRole("button", { name: /Self-hosted/ })).toBeTruthy();
});

it("offers Misty Cloud, then the person's own server, and no way on without one", () => {
  render(<SignInSheet />);
  act(() => openSignInSheet("setup"));
  const choices = screen
    .getAllByRole("button")
    .map((button) => button.textContent)
    .filter((label) => label === "Misty Cloud" || label === "Self-hosted");
  expect(choices).toEqual(["Misty Cloud", "Self-hosted"]);
  expect(screen.queryByRole("button", { name: /Only this computer/ })).toBeNull();
});

it("asks for the setup key when only the server's address is pasted", () => {
  useServerChoice.setState({ loaded: true, choice: { mode: "none" } });
  render(<SignInSheet />);
  act(() => openSignInSheet("setup"));
  fireEvent.click(screen.getByRole("button", { name: "Use a sign-in link" }));
  const continueButton = () =>
    screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
  expect(continueButton().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Sign-in link"), {
    target: { value: "cloud.misty.example" },
  });
  expect(screen.getByLabelText("Setup key")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Setup key"), {
    target: { value: "misty_setup_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" },
  });
  expect(continueButton().disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Sign-in link"), {
    target: {
      value: "https://cloud.misty.example/setup#key=misty_setup_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    },
  });
  expect(screen.queryByLabelText("Setup key")).toBeNull();
  expect(continueButton().disabled).toBe(false);
});
