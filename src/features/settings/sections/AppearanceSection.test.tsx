import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as SettingsControlsModule from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { AppearanceSection } from "./AppearanceSection";

const zoomMocks = vi.hoisted(() => ({
  current: 1,
  setAppZoom: vi.fn(),
}));

vi.mock("@/shared/hooks/useAppZoom", () => ({
  appZoomDefault: 1,
  appZoomMin: 0.8,
  appZoomMax: 2,
  appZoomStep: 0.1,
  setAppZoom: zoomMocks.setAppZoom,
  useAppZoomValue: () => zoomMocks.current,
}));

vi.mock("@/features/app-shell", () => ({
  publishNavigatorLayout: vi.fn(),
  useNavigatorLayoutValue: () => ({ visibility: "sticky" }),
}));

vi.mock("../settingsControls", async () => {
  const actual = await vi.importActual<typeof SettingsControlsModule>("../settingsControls");
  return {
    ...actual,
    SliderControl: (props: {
      value: number;
      min: number;
      format?: (value: number) => string;
      onChange?: (value: number) => void;
      onCommit: (value: number) => void;
    }) => {
      if (props.min !== 0.8) return <span>Panel opacity</span>;
      return (
        <div>
          <output>{props.format?.(props.value) ?? props.value}</output>
          <button type="button" onClick={() => props.onChange?.(1.1)}>
            Preview zoom
          </button>
          <button type="button" onClick={() => props.onCommit(1.1)}>
            Commit zoom
          </button>
        </div>
      );
    },
  };
});

describe("AppearanceSection app zoom", () => {
  const onSettingChange = vi.fn();
  const props: SettingsContentProps = {
    document: {},
    launchOnLogin: null,
    working: false,
    onSettingChange,
    onLoad: vi.fn(async () => undefined),
    onShortcutChange: vi.fn(async () => undefined),
    onShortcutReassign: vi.fn(async () => undefined),
    onResetShortcuts: vi.fn(async () => undefined),
    onRemoveOpenWithAssociation: vi.fn(async () => undefined),
    shortcuts: null,
    openWithAssociations: [],
    app: null,
  };

  beforeEach(() => {
    zoomMocks.current = 1;
    zoomMocks.setAppZoom.mockClear();
    onSettingChange.mockClear();
  });

  it("starts at 100% and updates the app while the slider moves", async () => {
    render(<AppearanceSection {...props} />);
    expect(screen.getByText("100%")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Preview zoom" }));
    expect(screen.getByText("110%")).toBeTruthy();
    await waitFor(() => expect(zoomMocks.setAppZoom).toHaveBeenCalledWith(1.1));
    expect(onSettingChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Commit zoom" }));
    expect(zoomMocks.setAppZoom).toHaveBeenCalledWith(1.1);
    expect(onSettingChange).toHaveBeenCalledWith("appearance", "app_zoom", 1.1);
  });

  it("resets a non-default zoom to 100%", () => {
    zoomMocks.current = 2;
    render(<AppearanceSection {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(zoomMocks.setAppZoom).toHaveBeenCalledWith(1);
    expect(onSettingChange).toHaveBeenCalledWith("appearance", "app_zoom", 1);
  });
});
