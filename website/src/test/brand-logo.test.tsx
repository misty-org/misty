import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandLogo } from "@/components/brand/BrandLogo";

describe("BrandLogo", () => {
  it("paints the official Misty mark with the current monochrome color", () => {
    const { container } = render(<BrandLogo />);
    const logo = container.querySelector<HTMLElement>(
      '[data-misty-brand-logo="monochrome"]',
    );

    expect(logo?.style.background.toLowerCase()).toContain("currentcolor");
    expect(logo?.style.mask).toContain("misty-white.png");
  });
});
