import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Text } from "../display/Text";
import { OverflowFadeText } from "./OverflowFadeText";

// The tooltip is its own component; here it only has to show what it was given.
vi.mock("../overlays/Tooltip", () => ({
  Tooltip: ({ content, children }: { content: string; children: ReactElement }) => (
    <div data-testid="tooltip" data-content={content}>
      {children}
    </div>
  ),
}));

function measure(sizes: {
  clientWidth?: number;
  scrollWidth?: number;
  clientHeight?: number;
  scrollHeight?: number;
}) {
  for (const [name, value] of Object.entries(sizes))
    vi.spyOn(HTMLElement.prototype, name as "clientWidth", "get").mockReturnValue(value);
}

afterEach(() => vi.restoreAllMocks());

describe("OverflowFadeText", () => {
  it("only fades text when its content exceeds the available width", () => {
    const { rerender } = render(<OverflowFadeText>Misty</OverflowFadeText>);
    const label = screen.getByText("Misty");

    expect(label.getAttribute("data-text-overflowing")).toBe("false");
    expect(label.className).not.toContain("fade-end");

    Object.defineProperties(label, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 140 },
    });
    rerender(<OverflowFadeText>A very long Space name</OverflowFadeText>);

    expect(label.getAttribute("data-text-overflowing")).toBe("true");
    expect(label.className).toContain("fade-end");

    Object.defineProperty(label, "scrollWidth", { configurable: true, value: 100 });
    rerender(<OverflowFadeText>Misty again</OverflowFadeText>);

    expect(label.getAttribute("data-text-overflowing")).toBe("false");
    expect(label.className).not.toContain("fade-end");
  });

  it("clips on one line and never draws an ellipsis", () => {
    render(<OverflowFadeText className="flex-1">Misty</OverflowFadeText>);
    const label = screen.getByText("Misty");

    expect(label.className).toContain("overflow-hidden");
    expect(label.className).toContain("whitespace-nowrap");
    expect(label.className).toContain("flex-1");
    expect(label.className).not.toMatch(/truncate|ellipsis|line-clamp/);
  });

  it("renders the element it is given and passes its ref through", () => {
    let node: HTMLElement | null = null;
    render(
      <OverflowFadeText as="h2" ref={(element) => void (node = element)}>
        Pages
      </OverflowFadeText>,
    );

    expect(screen.getByRole("heading", { name: "Pages" })).toBe(node);
  });

  it("shows the whole text in a tooltip only while it is cut", () => {
    const { rerender } = render(<OverflowFadeText full>Misty</OverflowFadeText>);
    expect(screen.queryByTestId("tooltip")).toBeNull();

    measure({ clientWidth: 100, scrollWidth: 140 });
    rerender(<OverflowFadeText full>A very long Space name</OverflowFadeText>);

    const tooltip = screen.getByTestId("tooltip");
    expect(tooltip.getAttribute("data-content")).toBe("A very long Space name");
    expect(screen.getByText("A very long Space name").className).toContain("fade-end");

    measure({ scrollWidth: 100 });
    rerender(<OverflowFadeText full>Misty</OverflowFadeText>);
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("shows a given string as the tooltip and no tooltip without full", () => {
    measure({ clientWidth: 100, scrollWidth: 140 });
    const { rerender } = render(
      <OverflowFadeText full="main · feature/long-branch-name">
        <b>feature/long-branch-name</b>
      </OverflowFadeText>,
    );
    expect(screen.getByTestId("tooltip").getAttribute("data-content")).toBe(
      "main · feature/long-branch-name",
    );

    rerender(<OverflowFadeText>feature/long-branch-name</OverflowFadeText>);
    expect(screen.queryByTestId("tooltip")).toBeNull();
    expect(screen.getByText("feature/long-branch-name").className).toContain("fade-end");
  });

  it("fades the second line of two-line text once it runs past it", () => {
    measure({ clientHeight: 44, scrollHeight: 88, clientWidth: 100, scrollWidth: 100 });
    render(<OverflowFadeText lines={2}>A title long enough for three lines</OverflowFadeText>);
    const label = screen.getByText("A title long enough for three lines");

    expect(label.className).toContain("whitespace-normal");
    expect(label.className).toContain("fade-end-2");
  });
});

describe("Text", () => {
  it("sets the role, tone and weight and still fades", () => {
    render(
      <Text size="meta" tone="muted" weight="medium">
        2 min ago
      </Text>,
    );
    const label = screen.getByText("2 min ago");

    expect(label.className).toContain("text-meta");
    expect(label.className).toContain("text-cream-muted");
    expect(label.className).toContain("font-medium");
    expect(label.className).toContain("whitespace-nowrap");
  });

  it("keeps the surrounding size and color when none is given", () => {
    render(<Text>Inherit</Text>);
    expect(screen.getByText("Inherit").className).not.toMatch(/\btext-/);
  });
});
