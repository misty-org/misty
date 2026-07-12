import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserZoomControls, useBrowserZoom } from "./BrowserZoomControls";
import { BrowserMenuView } from "./BrowserMenuView";

afterEach(cleanup);
function Controls({
  id = "page",
  apply,
  report = () => {},
}: {
  id?: string;
  apply: (factor: number) => Promise<void>;
  report?: (error: unknown) => void;
}) {
  return <BrowserZoomControls zoom={useBrowserZoom(id, apply, report)} />;
}

it("steps, resets, caps zoom and retains the confirmed value after failure", async () => {
  const apply = vi.fn(async (_factor: number) => {}),
    report = vi.fn();
  const ui = render(<Controls apply={apply} report={report} />);
  const click = async (name: string) =>
    act(async () => fireEvent.click(ui.getByRole("button", { name })));
  await click("Zoom in");
  expect(apply).toHaveBeenLastCalledWith(1.1);
  expect(ui.getByText("110%")).toBeTruthy();
  await click("Reset zoom to 100%");
  expect(apply).toHaveBeenLastCalledWith(1);
  await click("Zoom out");
  expect(ui.getByText("90%")).toBeTruthy();
  apply.mockRejectedValueOnce(new Error("Page unavailable"));
  await click("Zoom in");
  expect(ui.getByText("90%")).toBeTruthy();
  expect(report).toHaveBeenCalledOnce();
  for (let i = 0; i < 12; i++) await click("Zoom out");
  expect(ui.getByText("25%")).toBeTruthy();
  expect(
    (ui.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  for (let i = 0; i < 22; i++) await click("Zoom in");
  expect(ui.getByText("500%")).toBeTruthy();
  expect(
    (ui.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("ignores a pending result from a replaced page and prevents duplicate requests", async () => {
  let resolve!: () => void;
  const apply = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const ui = render(<Controls id="first" apply={apply} />);
  fireEvent.click(ui.getByRole("button", { name: "Zoom in" }));
  fireEvent.click(ui.getByRole("button", { name: "Zoom in" }));
  expect(apply).toHaveBeenCalledOnce();
  ui.rerender(<Controls id="second" apply={apply} />);
  await act(async () => resolve());
  expect(ui.getByText("100%")).toBeTruthy();
});

it("keeps the Browser dropdown open across zoom adjustments and reopening", async () => {
  const setZoom = vi.fn(async () => {});
  const ui = render(
    <BrowserMenuView
      iconButtonClass=""
      zoomId="page"
      setZoom={setZoom}
      url="https://example.com"
      setOverlay={async () => {}}
      openExternal={async () => {}}
      reportError={vi.fn()}
    />,
  );
  const open = () =>
    fireEvent.pointerDown(ui.getByRole("button", { name: "Browser menu" }), { button: 0 });
  open();
  const plus = await ui.findByRole("menuitem", { name: "Zoom in" });
  await act(async () => fireEvent.click(plus));
  expect(setZoom).toHaveBeenLastCalledWith(1.1);
  expect(ui.getByRole("menu")).toBeTruthy();
  expect(ui.getByText("110%")).toBeTruthy();
  fireEvent.keyDown(ui.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(ui.queryByRole("menu")).toBeNull());
  open();
  expect(await ui.findByText("110%")).toBeTruthy();
});
