import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginPanelElementView } from "./PluginPanelElementView";

afterEach(cleanup);
it("renders widget strings as text, never HTML or executable event handlers", () => {
  const view = render(
    <PluginPanelElementView
      element={{
        kind: "text",
        id: "a",
        text: '<img src=x onerror="alert(1)">',
        width: 0,
        height: 0,
        border: false,
      }}
      value=""
      disabled={false}
      onInput={vi.fn()}
      onButton={vi.fn()}
    />,
  );
  expect(view.getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
  expect(view.container.querySelector("img")).toBeNull();
  expect(view.container.querySelector("script")).toBeNull();
});
it("dispatches a widget button only through the supplied host handler", () => {
  const press = vi.fn();
  const view = render(
    <PluginPanelElementView
      element={{
        kind: "button",
        id: "preview",
        text: "Preview",
        width: 0,
        height: 0,
        border: false,
      }}
      value=""
      disabled={false}
      onInput={vi.fn()}
      onButton={press}
    />,
  );
  fireEvent.click(view.getByText("Preview"));
  expect(press).toHaveBeenCalledOnce();
});
