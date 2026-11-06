import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  authenticateAccount: vi.fn(),
  accountRegister: vi.fn(),
  accountSignIn: vi.fn(),
  accountWaitForConfirmation: vi.fn(),
}));

vi.mock("@/api/account/api", () => ({
  accountApi: { googleAvailable: async () => ({ enabled: false }) },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof ReactRouterDomModule>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("./AuthContext", () => ({
  useAuth: () => ({
    authenticateAccount: mocks.authenticateAccount,
  }),
}));

vi.mock("./store/useAccountStore", () => ({
  accountRegister: mocks.accountRegister,
  accountSignIn: mocks.accountSignIn,
  accountWaitForConfirmation: mocks.accountWaitForConfirmation,
}));

import { ConfirmEmailSent } from "./store/confirmEmailSent";
import RegisterPage from "./RegisterPage";
import type * as ReactRouterDomModule from "react-router-dom";

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const backButtonIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Back",
  ) ?? null;

describe("RegisterPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders the register form when addingAccount is false", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/register"]}>
          <RegisterPage />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Create an account");
    expect(container.querySelector('input[id="register-name"]')).toBeNull();
    expect(container.querySelector('input[id="register-username"]')).not.toBeNull();
    expect(container.querySelector('input[id="register-email"]')).not.toBeNull();
    expect(container.querySelector('input[id="register-password"]')).not.toBeNull();
    expect(container.textContent).toContain("Already have an account? Sign in");
    expect(container.textContent).not.toContain("Create an account on the website");
  });

  it("renders the in-app registration form when addingAccount is true", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            { pathname: "/register", state: { from: "/spaces/main", addingAccount: true } },
          ]}
        >
          <RegisterPage />
        </MemoryRouter>,
      );
    });

    // Nobody is signed in here, so it isn't "another" account.
    expect(container.textContent).toContain("Create an account");
    expect(container.textContent).not.toContain(
      "Your current account will remain signed in on this device.",
    );

    const usernameInput = container.querySelector<HTMLInputElement>(
      'input[id="register-username"]',
    );
    const emailInput = container.querySelector<HTMLInputElement>('input[id="register-email"]');
    const passwordInput = container.querySelector<HTMLInputElement>(
      'input[id="register-password"]',
    );
    expect(usernameInput).not.toBeNull();
    expect(emailInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();

    expect(container.textContent).not.toContain("Create an account on the website");
    expect(container.textContent).not.toContain("Sign in on the website");

    // The page has no back button: the logo in the bar goes to the welcome page.
    expect(backButtonIn(container)).toBeNull();
    expect(container.textContent).not.toContain("Return to app");
  });

  it("says to check email when the account waits for its email to be confirmed", async () => {
    mocks.accountRegister.mockRejectedValue(new ConfirmEmailSent());
    mocks.accountWaitForConfirmation.mockReturnValue(new Promise(() => {}));
    mocks.authenticateAccount.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/register"]}>
          <RegisterPage />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      setInputValue(container.querySelector('input[id="register-username"]')!, "carol");
      setInputValue(container.querySelector('input[id="register-email"]')!, "carol@example.com");
      setInputValue(container.querySelector('input[id="register-password"]')!, "a long password");
    });
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });

    expect(container.textContent).toContain("We sent a link to carol@example.com.");
    expect(container.querySelector('input[id="register-email"]')).toBeNull();
    expect(mocks.accountSignIn).not.toHaveBeenCalled();
  });

  it("signs in by itself once the link has made the account", async () => {
    mocks.accountRegister.mockRejectedValue(new ConfirmEmailSent());
    mocks.accountWaitForConfirmation.mockResolvedValue(undefined);
    mocks.accountSignIn.mockResolvedValue({ id: "acc-3", email: "carol@example.com" });
    mocks.authenticateAccount.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/register"]}>
          <RegisterPage />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      setInputValue(container.querySelector('input[id="register-username"]')!, "carol");
      setInputValue(container.querySelector('input[id="register-email"]')!, "carol@example.com");
      setInputValue(container.querySelector('input[id="register-password"]')!, "a long password");
    });
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
    });

    expect(mocks.accountSignIn).toHaveBeenCalledWith("carol@example.com", "a long password");
  });

  it("submits registration and authenticates when adding another account", async () => {
    mocks.accountRegister.mockResolvedValue({
      id: "acc-3",
      email: "carol@example.com",
      username: "Carol",
    });
    mocks.authenticateAccount.mockImplementation(async (fn: () => Promise<unknown>) => fn());

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            { pathname: "/register", state: { from: "/spaces/main", addingAccount: true } },
          ]}
        >
          <RegisterPage />
        </MemoryRouter>,
      );
    });

    const usernameInput = container.querySelector<HTMLInputElement>(
      'input[id="register-username"]',
    )!;
    const emailInput = container.querySelector<HTMLInputElement>('input[id="register-email"]')!;
    const passwordInput = container.querySelector<HTMLInputElement>(
      'input[id="register-password"]',
    )!;
    const form = container.querySelector<HTMLFormElement>("form")!;

    await act(async () => {
      setInputValue(usernameInput, "carol_user");
      setInputValue(emailInput, "carol@example.com");
      setInputValue(passwordInput, "secret12345");
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mocks.authenticateAccount).toHaveBeenCalled();
    expect(mocks.accountRegister).toHaveBeenCalledWith(
      "carol_user",
      "carol@example.com",
      "secret12345",
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/spaces/main", { replace: true });
  });
});
