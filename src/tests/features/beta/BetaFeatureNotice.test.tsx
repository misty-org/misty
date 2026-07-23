import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Bot } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BetaFeatureNotice } from "@/features/beta/BetaFeatureNotice";
import { openExternalLink } from "@/platform/openExternalLink";

vi.mock("@/platform/openExternalLink", () => ({
  openExternalLink: vi.fn(),
}));

describe("BetaFeatureNotice", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("shows the v0.2.0 estimate and opens the Misty website", async () => {
    await act(async () => {
      root.render(<BetaFeatureNotice featureName="Agents" icon={Bot} />);
    });

    expect(container.textContent).toContain("Agents are coming soon");
    expect(container.textContent).toContain("beta v0.2.0");
    expect(container.textContent).toContain("August 9, 2026");

    const websiteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Visit mistysys.com"),
    );
    await act(async () => websiteButton?.click());

    expect(openExternalLink).toHaveBeenCalledWith("https://mistysys.com");
  });
});
