import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CompanionAppearanceSettings } from "./CompanionAppearanceSettings";
import { initialCompanionPresentation, useCompanionState } from "./companionState";
vi.mock("@/shared/platform/tauri", () => ({
  hasTauriInternals: () => true,
}));
afterEach(cleanup);
it("offers immediate size and visibility controls in agent settings", () => {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  const control = vi.fn().mockResolvedValue(undefined);
  useCompanionState.setState({
    presentation: {
      ...initialCompanionPresentation,
      size: 150,
      showCompanion: false,
    },
    control,
  });
  render(<CompanionAppearanceSettings />);
  fireEvent.change(
    screen.getByRole("slider", {
      name: "Companion size",
    }),
    {
      target: {
        value: "175",
      },
    },
  );
  expect(control).toHaveBeenCalledWith({
    kind: "size",
    size: 175,
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Reset size",
    }),
  );
  expect(control).toHaveBeenCalledWith({
    kind: "size",
    size: 100,
  });
  fireEvent.click(
    screen.getByRole("switch", {
      name: "Show cursor companion",
    }),
  );
  expect(control).toHaveBeenCalledWith({
    kind: "visibility",
    visible: true,
  });
});
