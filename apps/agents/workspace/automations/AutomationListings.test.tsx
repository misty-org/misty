import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callTool } = vi.hoisted(() => ({
  callTool: vi.fn().mockResolvedValue({ structured_content: { steps: [] } }),
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Matthew Chen" } }),
  useAccountAvatarUrl: () => "",
}));
vi.mock("./api", () => ({ automationsApi: { callTool } }));

import { AutomationListings } from "./AutomationListings";

const flows = [
  {
    id: "flow-1",
    name: "Pinned workflow",
    status: "enabled" as const,
    trigger: "Schedule",
  },
  {
    id: "flow-2",
    name: "Recent workflow",
    status: "disabled" as const,
    trigger: "Gmail",
  },
];

describe("AutomationListings collection layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.setItem("misty:automation-pins:user-1", JSON.stringify(["flow-1"]));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    window.localStorage.clear();
    container.remove();
  });

  it("keeps the header outside the panel and flattens results while searching", async () => {
    await act(async () => {
      root.render(
        <AutomationListings
          flows={flows}
          connected
          loading={false}
          error=""
          onRefresh={vi.fn()}
          onCreate={vi.fn()}
          onOpen={vi.fn()}
        />,
      );
    });

    const heading = container.querySelector("h1");
    expect(heading?.textContent).toBe("My Automations");
    expect(heading?.closest(".rounded-2xl")).toBeNull();
    expect(container.querySelector('section[aria-label="Pinned"]')?.textContent).toContain(
      "Pinned workflow",
    );
    expect(container.querySelector('section[aria-label="Recently edited"]')?.textContent).toContain(
      "Recent workflow",
    );

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search automations"]',
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search,
        "Recent",
      );
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.querySelector('section[aria-label="Pinned"]')).toBeNull();
    expect(container.querySelector('section[aria-label="Recently edited"]')).toBeNull();
    expect(container.textContent).toContain("Recent workflow");
    expect(container.textContent).not.toContain("Pinned workflow");
  });
});
