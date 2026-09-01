import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsContentProps } from "../settingsTypes";

vi.mock("@/features/spaces", () => ({
  formatStorageBytes: (bytes: number) => `${bytes / 1_000_000_000} GB`,
  useBillingUsage: () => ({
    plan: "pro",
    entitlements: { max_owned_spaces: 10 },
    personal: {
      storage: {
        used_bytes: 5_000_000_000,
        reserved_bytes: 0,
        limit_bytes: 50_000_000_000,
        remaining_bytes: 45_000_000_000,
      },
      ai: {
        used: 20,
        reserved: 0,
        limit: 100,
        remaining: 80,
        used_ratio: 0.2,
        available: true,
        paused: false,
      },
    },
  }),
  useSpacesStore: (selector: (state: unknown) => unknown) =>
    selector({
      ownerStorage: null,
      limits: null,
      spaces: [{ role: "owner" }, { role: "member" }],
    }),
}));

const { AccountSection } = await import("./AccountSection");

describe("AccountSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows global personal usage and the owned-Space limit", async () => {
    await act(async () => root.render(<AccountSection {...({} as SettingsContentProps)} />));

    const text = container.textContent ?? "";
    expect(text).toContain("5 GB of 50 GB used");
    expect(text).toContain("20% used");
    expect(text).toContain("1 of 10 owned");
    expect(text).toContain("Joining other people’s Spaces does not count");
  });
});
