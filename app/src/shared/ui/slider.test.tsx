import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Slider } from "./slider";

describe("Slider", () => {
  it("puts its accessible name and formatted value on the interactive thumb", () => {
    render(
      <Slider
        aria-label="App zoom"
        aria-valuetext="100%"
        min={0.8}
        max={2}
        step={0.1}
        value={[1]}
      />,
    );

    const thumb = screen.getByRole("slider", { name: "App zoom" });
    expect(thumb.getAttribute("aria-valuetext")).toBe("100%");
  });
});
