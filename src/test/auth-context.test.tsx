import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MeResponse } from "../pages/AccountSettings/api";

vi.mock("../pages/AccountSettings/api", () => ({
  fetchMe: vi.fn(),
  logoutRequest: vi.fn().mockResolvedValue(undefined),
}));

import { AuthProvider, useAuth } from "../AuthContext";
import { fetchMe } from "../pages/AccountSettings/api";
import { useUserStore } from "../store/userStore";

const account: MeResponse = {
  id: "user-123",
  name: "Maya Chen",
  email: "maya@misty.local",
  created_at: "2026-07-01T00:00:00Z",
  tier: "pro",
  status: "active",
  allows_use: true,
  expires_at: null,
  trial_started_at: null,
  license_device: "",
};

function SessionProbe() {
  const { user } = useAuth();
  return <div>{user?.email ?? "signed out"}</div>;
}

function renderProvider() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockReset();
    useUserStore.getState().clear();
  });

  it("restores authentication from the server session cookie", async () => {
    vi.mocked(fetchMe).mockResolvedValue(account);

    renderProvider();

    expect(await screen.findByText(account.email)).toBeInTheDocument();
    expect(useUserStore.getState().me).toEqual(account);
  });

  it("ignores legacy local auth state and stays signed out without a server session", async () => {
    window.localStorage.setItem(
      "misty_user",
      JSON.stringify({
        id: "stale-user",
        name: "Stale User",
        email: "stale@misty.local",
      }),
    );
    const getItem = vi.spyOn(window.localStorage, "getItem");
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const removeItem = vi.spyOn(window.localStorage, "removeItem");
    vi.mocked(fetchMe).mockRejectedValue(
      Object.assign(new Error("not authenticated"), { status: 401 }),
    );

    renderProvider();

    await waitFor(() => expect(fetchMe).toHaveBeenCalledOnce());
    expect(screen.getByText("signed out")).toBeInTheDocument();
    expect(screen.queryByText("stale@misty.local")).not.toBeInTheDocument();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
