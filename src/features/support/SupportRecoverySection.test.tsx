import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadBundle: vi.fn(async () => undefined),
  openExternal: vi.fn<(url: string) => Promise<void>>(async () => undefined),
  recoverTab: vi.fn(() => true),
  reload: vi.fn(),
  resetLayout: vi.fn(),
}));

vi.mock("@/telemetry/metadata", () => ({
  clientMetadata: vi.fn(async () => ({
    app_version: "0.1.0",
    platform: "macos",
    release_channel: "public_beta",
  })),
}));

vi.mock("@/shared/platform/openExternalLink", () => ({
  openSystemExternalLink: mocks.openExternal,
  configureExternalLinkPreference: vi.fn(),
}));

vi.mock("./supportBundle", () => ({ downloadSupportBundle: mocks.downloadBundle }));
vi.mock("./recoveryActions", () => ({
  recoverLastClosedWorkspaceTab: mocks.recoverTab,
  reloadMisty: mocks.reload,
  resetWorkspaceLayout: mocks.resetLayout,
}));

import { useTourStore } from "@/features/tour";
import { SupportRecoverySection } from "./SupportRecoverySection";

describe("SupportRecoverySection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("requires a second click before resetting the workspace layout", async () => {
    await act(async () => root.render(<SupportRecoverySection />));
    const button = () =>
      Array.from(container.querySelectorAll("button")).find((candidate) =>
        candidate.textContent?.includes("Reset layout"),
      );

    await act(async () => button()?.click());
    expect(mocks.resetLayout).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Saved content is not deleted");

    const confirm = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Confirm reset"),
    );
    await act(async () => confirm?.click());
    expect(mocks.resetLayout).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("account data were untouched");
  });

  it("keeps diagnostics as a separate local download", async () => {
    await act(async () => root.render(<SupportRecoverySection />));
    const download = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Download diagnostics"),
    );

    await act(async () => download?.click());
    expect(mocks.downloadBundle).toHaveBeenCalledOnce();
    expect(mocks.openExternal).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Review the JSON file");
  });

  it("opens a reviewable public ticket without attaching diagnostics", async () => {
    await act(async () => root.render(<SupportRecoverySection />));
    const summary = container.querySelector<HTMLInputElement>(
      'input[placeholder="What went wrong or could be better?"]',
    );
    const details = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder^="Tell us what you were doing"]',
    );
    await act(async () => {
      setFormValue(summary, "Planner focus jumps");
      setFormValue(details, "It jumps after creating a task.");
    });
    const continueButton = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Continue to public ticket"),
    );

    await act(async () => continueButton?.click());
    expect(mocks.openExternal).toHaveBeenCalledOnce();
    const issueUrl = new URL(String(mocks.openExternal.mock.calls[0]?.[0]));
    expect(issueUrl.pathname).toBe("/misty-org/misty-public/issues/new");
    expect(issueUrl.searchParams.get("title")).toContain("Planner focus jumps");
    expect(mocks.downloadBundle).not.toHaveBeenCalled();
  });

  it("replays the app tour and closes settings when requested", async () => {
    useTourStore.setState({ isOpen: false, currentStep: "closed" });
    const closeSettingsListener = vi.fn();
    window.addEventListener("misty:close-settings", closeSettingsListener);

    await act(async () => root.render(<SupportRecoverySection />));
    const startTourButton = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Start tour"),
    );
    expect(startTourButton).toBeDefined();

    await act(async () => startTourButton?.click());

    expect(closeSettingsListener).toHaveBeenCalledOnce();
    expect(useTourStore.getState().isOpen).toBe(true);
    expect(useTourStore.getState().currentStep).toBe("welcome");
    window.removeEventListener("misty:close-settings", closeSettingsListener);
  });
});

function setFormValue(element: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!element) throw new Error("Expected form control");
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}
