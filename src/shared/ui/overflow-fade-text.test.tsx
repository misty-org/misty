import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverflowFadeText } from "./overflow-fade-text";

describe("OverflowFadeText", () => {
  it("only fades text when its content exceeds the available width", () => {
    const { rerender } = render(<OverflowFadeText>Misty</OverflowFadeText>);
    const label = screen.getByText("Misty");

    expect(label.getAttribute("data-text-overflowing")).toBe("false");
    expect(label.className).not.toContain("mask-image");

    Object.defineProperties(label, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 140 },
    });
    rerender(<OverflowFadeText>A very long Space name</OverflowFadeText>);

    expect(label.getAttribute("data-text-overflowing")).toBe("true");
    expect(label.className).toContain("mask-image");

    Object.defineProperty(label, "scrollWidth", { configurable: true, value: 100 });
    rerender(<OverflowFadeText>Misty again</OverflowFadeText>);

    expect(label.getAttribute("data-text-overflowing")).toBe("false");
    expect(label.className).not.toContain("mask-image");
  });
});
