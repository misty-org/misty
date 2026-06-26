import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Box, FlexRow, Stack } from "./layout";

describe("Layout CVA primitives", () => {
  it("renders Box with block display by default", () => {
    const { container } = render(<Box>Content</Box>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("block");
    expect(el.className).toContain("min-w-0");
  });

  it("renders Stack with flex-col and gap variant", () => {
    const { container } = render(<Stack gap="md" align="center">Content</Stack>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("flex");
    expect(el.className).toContain("flex-col");
    expect(el.className).toContain("gap-2");
    expect(el.className).toContain("items-center");
  });

  it("renders FlexRow with flex-row and justify-between", () => {
    const { container } = render(
      <FlexRow gap="lg" justify="between">
        <span>Left</span>
        <span>Right</span>
      </FlexRow>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("flex");
    expect(el.className).toContain("flex-row");
    expect(el.className).toContain("gap-3");
    expect(el.className).toContain("justify-between");
  });
});
