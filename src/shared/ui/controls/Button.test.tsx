import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button CVA variants", () => {
  it("renders default button with standard styling", () => {
    const { getByRole } = render(<Button>Click me</Button>);
    const btn = getByRole("button", { name: "Click me" });
    expect(btn.className).toContain("bg-charcoal-active");
    expect(btn.getAttribute("data-variant")).toBe("default");
    expect(btn.getAttribute("data-size")).toBe("default");
  });

  it("renders chip variant that fills while pressed", () => {
    const { getByRole } = render(
      <Button variant="chip" size="chip" aria-pressed>
        Tag
      </Button>,
    );
    const btn = getByRole("button", { name: "Tag" });
    expect(btn.className).toContain("rounded-full");
    expect(btn.className).toContain("aria-pressed:bg-charcoal-active");
    expect(btn.getAttribute("data-variant")).toBe("chip");
    expect(btn.getAttribute("data-size")).toBe("chip");
  });

  it("renders reveal row-hover variant with opacity-0 and hover classes", () => {
    const { getByRole } = render(
      <Button variant="chip" size="chip" reveal="row-hover">
        Hover Pill
      </Button>,
    );
    const btn = getByRole("button", { name: "Hover Pill" });
    expect(btn.className).toContain("opacity-0");
    expect(btn.className).toContain("pointer-events-none");
    expect(btn.className).toContain("group-hover/app-row:opacity-100");
    expect(btn.className).toContain("group-hover/app-row:pointer-events-auto");
  });

  it("renders nav-action variant with tree-hover reveal", () => {
    const { getByRole } = render(
      <Button variant="nav-action" size="icon-sm" reveal="tree-hover" aria-label="Action">
        ✕
      </Button>,
    );
    const btn = getByRole("button", { name: "Action" });
    expect(btn.className).toContain("rounded-md");
    expect(btn.className).toContain("bg-transparent");
    expect(btn.className).toContain("!opacity-0");
    expect(btn.className).toContain("group-hover/tree-row:!opacity-100");
  });
});
