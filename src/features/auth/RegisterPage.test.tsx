import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  authenticateAccount: vi.fn(),
  accountRegister: vi.fn(),
  fetchCurrentInstanceDescriptor: vi.fn().mockResolvedValue({
    deployment: "cloud",
    bootstrap_required: false,
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
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
}));


vi.mock("@/api/deployment/api", () => ({
  fetchCurrentInstanceDescriptor: mocks.fetchCurrentInstanceDescriptor,
}));

import RegisterPage from "./RegisterPage";

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

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
    expect(container.querySelector('input[id="register-name"]')).not.toBeNull();
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
          initialEntries={[{ pathname: "/register", state: { from: "/spaces/main", addingAccount: true } }]}
        >
          <RegisterPage />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Create another account");
    expect(container.textContent).toContain("Your current account will remain signed in on this device.");

    const nameInput = container.querySelector<HTMLInputElement>('input[id="register-name"]');
    const usernameInput = container.querySelector<HTMLInputElement>('input[id="register-username"]');
    const emailInput = container.querySelector<HTMLInputElement>('input[id="register-email"]');
    const passwordInput = container.querySelector<HTMLInputElement>('input[id="register-password"]');
    expect(nameInput).not.toBeNull();
    expect(usernameInput).not.toBeNull();
    expect(emailInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();

    expect(container.textContent).not.toContain("Create an account on the website");
    expect(container.textContent).not.toContain("Sign in on the website");

    const backButton = container.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
    expect(backButton).not.toBeNull();
    expect(container.textContent).not.toContain("Return to app");

    await act(async () => {
      backButton?.click();
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/spaces/main", { replace: true });
  });

  it("submits registration and authenticates when adding another account", async () => {
    mocks.accountRegister.mockResolvedValue({ id: "acc-3", email: "carol@example.com", name: "Carol" });
    mocks.authenticateAccount.mockImplementation(async (fn: () => Promise<unknown>) => fn());

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[{ pathname: "/register", state: { from: "/spaces/main", addingAccount: true } }]}
        >
          <RegisterPage />
        </MemoryRouter>,
      );
    });

    const nameInput = container.querySelector<HTMLInputElement>('input[id="register-name"]')!;
    const usernameInput = container.querySelector<HTMLInputElement>('input[id="register-username"]')!;
    const emailInput = container.querySelector<HTMLInputElement>('input[id="register-email"]')!;
    const passwordInput = container.querySelector<HTMLInputElement>('input[id="register-password"]')!;
    const form = container.querySelector<HTMLFormElement>("form")!;

    await act(async () => {
      setInputValue(nameInput, "Carol");
      setInputValue(usernameInput, "carol_user");
      setInputValue(emailInput, "carol@example.com");
      setInputValue(passwordInput, "secret12345");
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mocks.authenticateAccount).toHaveBeenCalled();
    expect(mocks.accountRegister).toHaveBeenCalledWith(
      "Carol",
      "carol_user",
      "carol@example.com",
      "secret12345",
      "",
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/spaces/main", { replace: true });
  });
});
