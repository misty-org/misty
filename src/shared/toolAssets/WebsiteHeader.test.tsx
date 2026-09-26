import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MistyAppSDK } from "@misty/sdk";
import { WebsiteHeader } from "./WebsiteHeader";
afterEach(cleanup);
function fixture() {
  const misty = {
    browser: {
      overlay: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
      setZoom: vi.fn(async () => {}),
    },
    links: { openExternal: vi.fn(async () => {}) },
  } as unknown as MistyAppSDK;
  const props = {
    misty,
    view: {
      handle: "view",
      contextId: "scope",
      url: "https://mail.google.com/mail/u/0/",
    },
    route: "/apps/inbox?provider=google",
    label: "Gmail",
    icon: null,
    url: "https://mail.google.com/mail/u/0/",
    onPin: vi.fn(),
    pinned: false,
    canPin: true,
    canOpenExternal: true,
    report: vi.fn(),
  };
  return { props, ui: render(<WebsiteHeader {...props} />) };
}
it("pins directly beside More and exposes its saved and pending states", () => {
  const { props, ui } = fixture();
  const bar = within(ui.getByRole("banner"));
  expect(
    bar.getAllByRole("button").map((b) => b.getAttribute("aria-label")),
  ).toEqual(["Refresh", "Pin", "More website actions"]);
  fireEvent.click(bar.getByRole("button", { name: "Pin" }));
  expect(props.onPin).toHaveBeenCalledOnce();
  expect(props.misty.browser.overlay).not.toHaveBeenCalled();
  ui.rerender(<WebsiteHeader {...props} pinned />);
  expect(
    bar.getByRole("button", { name: "Unpin" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(bar.getByRole("button", { name: "Unpin" }));
  expect(props.onPin).toHaveBeenCalledTimes(2);
  ui.rerender(<WebsiteHeader {...props} pinned pinBusy />);
  expect(
    (bar.getByRole("button", { name: "Unpin" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("keeps only Zoom and Open link in More, and leaves zoom open for repeated adjustment", async () => {
  const { props, ui } = fixture();
  fireEvent.click(ui.getByRole("button", { name: "More website actions" }));
  const open = await ui.findByRole("button", { name: "Open link" });
  const menu = within(open.closest(".website-header-menu") as HTMLElement);
  expect(
    menu
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") || b.textContent?.trim()),
  ).toEqual(["Zoom out", "Reset zoom to 100%", "Zoom in", "Open link"]);
  fireEvent.click(menu.getByRole("button", { name: "Zoom in" }));
  await waitFor(() =>
    expect(props.misty.browser.setZoom).toHaveBeenCalledWith("view", 1.1),
  );
  expect(ui.getByRole("button", { name: "Open link" })).toBeTruthy();
  fireEvent.click(open);
  expect(props.misty.links.openExternal).toHaveBeenCalledWith(props.url);
  await waitFor(() =>
    expect(ui.queryByRole("button", { name: "Open link" })).toBeNull(),
  );
});
it("disables pinning until a safe page and storage are ready", () => {
  const { props, ui } = fixture();
  ui.rerender(<WebsiteHeader {...props} canPin={false} />);
  fireEvent.click(ui.getByRole("button", { name: "Pin" }));
  expect(props.onPin).not.toHaveBeenCalled();
});
it("keeps Outlook identity visible during sign-in without a return control", async () => {
  const navigate = vi.fn(async () => {});
  const misty = { browser: { navigate }, links: {} } as unknown as MistyAppSDK;
  const props = {
    misty,
    view: {
      handle: "work-view",
      contextId: "work",
      url: "https://outlook.office.com/mail/inbox/id/message-1",
    },
    route: "/apps/inbox?provider=microsoft",
    label: "Outlook",
    providerId: "microsoft" as const,
    icon: null,
    onPin: vi.fn(),
    pinned: false,
    report: vi.fn(),
  };
  const ui = render(<WebsiteHeader {...props} url={props.view.url} />);
  const outside =
    "https://organization.example/sign-in?redirect_uri=https://evil.invalid&code=private";
  ui.rerender(
    <WebsiteHeader {...props} url={outside} title="Organization sign-in" />,
  );
  expect(ui.getByRole("banner").textContent).toContain("Outlook");
  expect(ui.getByRole("banner").textContent).toContain("organization.example");
  expect(ui.getByRole("banner").textContent).not.toContain(
    "Organization sign-in",
  );
  expect(ui.getByRole("banner").textContent).not.toContain("private");
  // Loading an auth page alone must not interrupt the login flow.
  expect(navigate).not.toHaveBeenCalled();
  expect(ui.queryByRole("button", { name: "Return to Outlook" })).toBeNull();
  ui.rerender(
    <WebsiteHeader {...props} url="https://outlook.office.com/mail/" />,
  );
  expect(ui.queryByRole("button", { name: "Return to Outlook" })).toBeNull();
});
