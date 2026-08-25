import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { MistyDesktopSurfaceRoot } from "./MistyDesktopSurface";

describe("MistyDesktopSurfaceRoot", () => {
  afterEach(cleanup);

  it("renders the collapsed pet inside its routing context", () => {
    render(<MistyDesktopSurfaceRoot surface="pet" />);

    expect(screen.getByRole("button", { name: "Open Misty Search" })).toBeTruthy();
  });
});
