import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vaultNative, type VaultState, type VaultUsage } from "./native";
import { useVaultState } from "./useVaultState";
import { VaultStartup } from "./VaultStartup";

function showWith(vault: VaultState) {
  useVaultState.setState({ vault });
  render(<VaultStartup />);
}

describe("VaultStartup", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useVaultState.setState({ vault: null });
  });

  it("offers to create a vault the first time", () => {
    showWith({ state: "off", exists: false, asked: false, notice: null });
    expect(screen.getByRole("heading", { name: "Sync this browser" })).toBeTruthy();
  });

  it("asks for the password when the account already has a vault", () => {
    showWith({ state: "off", exists: true, asked: false, notice: null });
    expect(screen.getByRole("heading", { name: "Enter your sync password" })).toBeTruthy();
  });

  it("never asks twice", () => {
    showWith({ state: "off", exists: false, asked: true, notice: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("waits while it can't tell whether the account has a vault", () => {
    showWith({ state: "off", exists: null, asked: false, notice: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells an account with no storage that, not that it's full", async () => {
    vi.spyOn(vaultNative, "usage").mockResolvedValue({ limitBytes: 0 } as VaultUsage);
    showWith({ state: "off", exists: true, asked: true, notice: "storage_full" });
    expect(
      await screen.findByRole("heading", { name: "This account has no sync storage yet" }),
    ).toBeTruthy();
  });

  it("says storage is full when the account has used what it has", async () => {
    const usage = vi
      .spyOn(vaultNative, "usage")
      .mockResolvedValue({ limitBytes: 1024 } as VaultUsage);
    showWith({ state: "off", exists: true, asked: true, notice: "storage_full" });
    await waitFor(() => expect(usage).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Sync storage is full" })).toBeTruthy();
  });

  it("only asks in the window in use", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    showWith({ state: "off", exists: false, asked: false, notice: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
