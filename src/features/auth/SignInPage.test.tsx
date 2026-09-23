import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type * as ReactRouter from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  user: null as { id: string; email: string; name: string } | null,
  transitioning: false,
  authenticateAccount: vi.fn(),
  resumeAccount: vi.fn(),
  removeAccount: vi.fn(),
  accountSignIn: vi.fn(),
}));

let mockAccounts: Array<{ id: string; email: string; name: string }> = [];

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof ReactRouter>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("./AuthContext", () => ({
  useAuth: () => ({
    accounts: mockAccounts,
    user: mocks.user,
    transitioning: mocks.transitioning,
    authenticateAccount: mocks.authenticateAccount,
    resumeAccount: mocks.resumeAccount,
    removeAccount: mocks.removeAccount,
  }),
}));

vi.mock("./store/useAccountStore", () => ({
  accountSignIn: mocks.accountSignIn,
}));


import SignIn from "./SignInPage";
import { SavedAccountSessionUnavailableError } from "./sessionErrors";

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("SignInPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockAccounts = [];
    mocks.user = null;
    mocks.transitioning = false;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders the sign-in form directly when no accounts are saved", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/signin"]}>
          <SignIn />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Welcome to Misty");
    expect(container.textContent).toContain("Sign in to begin.");
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.textContent).toContain("Don't have an account? Sign up");
    expect(container.textContent).not.toContain("Sign in on the website");
  });

  it("renders the account chooser when existing accounts are present", async () => {
    mockAccounts = [
      { id: "acc-1", email: "alice@example.com", name: "Alice" },
      { id: "acc-2", email: "bob@example.com", name: "Bob" },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/signin"]}>
          <SignIn />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Choose an account");
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("Bob");
    expect(container.textContent).toContain("Use another account");
  });

  it("renders the in-app credentials form when addingAccount is true", async () => {
    mocks.user = { id: "acc-1", email: "alice@example.com", name: "Alice" };
    mockAccounts = [{ id: "acc-1", email: "alice@example.com", name: "Alice" }];

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            { pathname: "/signin", state: { from: "/spaces/main", addingAccount: true } },
          ]}
        >
          <SignIn />
        </MemoryRouter>,
      );
    });

    // Verify title and description
    expect(container.textContent).toContain("Add another account");
    expect(container.textContent).toContain(
      "Your current account will remain signed in on this device.",
    );

    // Verify actual input fields are rendered, NOT dead website buttons
    const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]');
    const passwordInput = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(emailInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();
    expect(container.textContent).not.toContain("Sign in on the website");
    expect(container.textContent).not.toContain("Create an account on the website");

    // Verify back arrow button is rendered and return to app text button is removed
    const backButton = container.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
    expect(backButton).not.toBeNull();
    expect(container.textContent).not.toContain("Return to app");

    // Clicking Back arrow navigates back to currently signed-in user
    await act(async () => {
      backButton?.click();
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/spaces/main", { replace: true });
  });

  it("returns to the requested route when identity arrives after an automatic sign-in redirect", async () => {
    function Destination() {
      const location = useLocation();
      return (
        <div>
          {location.pathname}
          {location.search}
        </div>
      );
    }
    const view = () => (
      <MemoryRouter
        initialEntries={[{ pathname: "/signin", state: { from: "/spaces/main?tab=files" } }]}
      >
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/spaces/main" element={<Destination />} />
        </Routes>
      </MemoryRouter>
    );
    await act(async () => {
      root.render(view());
    });
    expect(container.querySelector("form")).not.toBeNull();
    mocks.user = { id: "acc-1", email: "alice@example.com", name: "Alice" };
    mocks.transitioning = true;
    await act(async () => {
      root.render(view());
    });
    expect(container.querySelector("form")).not.toBeNull();
    mocks.transitioning = false;
    await act(async () => {
      root.render(view());
    });
    expect(container.textContent).toBe("/spaces/main?tab=files");
    expect(container.querySelector("form")).toBeNull();
  });

  it.each(["offline", "expired"])(
    "shows a useful saved-account error when restoration is %s",
    async (outcome) => {
      mockAccounts = [{ id: "acc-1", email: "alice@example.com", name: "Alice" }];
      mocks.resumeAccount.mockRejectedValueOnce(
        outcome === "expired"
          ? new SavedAccountSessionUnavailableError()
          : new Error("Could not reach the Misty server"),
      );
      await act(async () => {
        root.render(
          <MemoryRouter>
            <SignIn />
          </MemoryRouter>,
        );
      });
      const account = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("alice@example.com"),
      )!;
      await act(async () => {
        account.click();
      });
      expect(mocks.navigate).not.toHaveBeenCalled();
      if (outcome === "expired") {
        expect(container.textContent).toContain(
          "Your saved sign-in for alice@example.com is no longer available",
        );
        expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe(
          "alice@example.com",
        );
      } else {
        expect(container.textContent).toContain("Choose an account");
        expect(container.textContent).toContain("Could not reach the Misty server");
        expect(account.disabled).toBe(false);
      }
    },
  );

  it("submits in-app credentials and authenticates when adding another account", async () => {
    mockAccounts = [{ id: "acc-1", email: "alice@example.com", name: "Alice" }];
    mocks.accountSignIn.mockResolvedValue({
      id: "acc-2",
      email: "new@example.com",
      name: "New User",
    });
    mocks.authenticateAccount.mockImplementation(async (fn: () => Promise<unknown>) => fn());

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            { pathname: "/signin", state: { from: "/spaces/main", addingAccount: true } },
          ]}
        >
          <SignIn />
        </MemoryRouter>,
      );
    });

    const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    const passwordInput = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    const form = container.querySelector<HTMLFormElement>("form")!;

    await act(async () => {
      setInputValue(emailInput, "new@example.com");
      setInputValue(passwordInput, "secret123");
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mocks.authenticateAccount).toHaveBeenCalled();
    expect(mocks.accountSignIn).toHaveBeenCalledWith("new@example.com", "secret123");
    expect(mocks.navigate).toHaveBeenCalledWith("/spaces/main", { replace: true });
  });
});
