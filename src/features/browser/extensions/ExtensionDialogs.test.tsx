import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("./native", () => ({ extensionsNative: { prepare: mocks.prepare } }));
import { InstallReviewDialog } from "./ExtensionDialogs";
import { ExtensionInstallRequest } from "./ExtensionInstallRequest";
import { useExtensionsStore } from "./store";
import type { ExtensionReview } from "./extensionTypes";

const review = {
  token: "review",
  entry: { id: "a", store: "chrome", guid: "a", name: "Fixture", version: "2.0", iconUrl: "" },
  permissions: ["storage", "tabs"],
  hosts: ["https://github.com/*", "<all_urls>"],
  addedPermissions: ["tabs"],
  addedHosts: ["<all_urls>"],
  optionalPermissions: [],
  optionalHosts: [],
  findings: [],
  blocked: false,
  privateAllowed: true,
  hasOptions: false,
  manifestVersion: 3,
} as unknown as ExtensionReview;

function dialog(existing: boolean) {
  return render(
    <InstallReviewDialog
      open
      review={review}
      existing={existing}
      busy={false}
      failure=""
      privateAccess={false}
      onPrivateAccess={vi.fn()}
      onClose={vi.fn()}
      onInstall={vi.fn()}
    />,
  );
}

describe("the install review", () => {
  afterEach(cleanup);

  it("lists everything a new extension asks for in plain words", () => {
    dialog(false);
    expect(screen.getByRole("heading", { name: "Add Fixture?" })).toBeTruthy();
    for (const line of [
      "Save extension settings",
      "Read browser tab titles and addresses",
      "Read and change data on github.com",
      "Read and change data on all websites",
    ])
      expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByText("<all_urls>")).toBeNull();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("shows an update only what's new, for the person to allow", () => {
    dialog(true);
    expect(screen.getByRole("heading", { name: "Review Fixture" })).toBeTruthy();
    expect(screen.getByText("It now also asks to:")).toBeTruthy();
    expect(screen.getByText("Read browser tab titles and addresses")).toBeTruthy();
    expect(screen.getByText("Read and change data on all websites")).toBeTruthy();
    expect(screen.queryByText("Save extension settings")).toBeNull();
    expect(screen.queryByText("Read and change data on github.com")).toBeNull();
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
  });

  it("leaves private tabs off until the person turns them on", async () => {
    mocks.prepare.mockResolvedValue(review);
    useExtensionsStore.setState({ account: "local", installRequest: "a" });
    render(<ExtensionInstallRequest />);
    expect(mocks.prepare).toHaveBeenCalledWith("a");
    const allow = await screen.findByRole("switch");
    expect(allow.getAttribute("aria-checked")).toBe("false");
    useExtensionsStore.setState({ installRequest: null });
  });
});
