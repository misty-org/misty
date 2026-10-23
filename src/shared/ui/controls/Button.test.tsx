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
});
