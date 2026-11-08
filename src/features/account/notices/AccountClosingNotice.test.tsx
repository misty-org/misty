import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountClosing } from "@/api/client/accountLimits";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "me@example.com", username: "me" } as {
    id: string;
    email: string;
    username: string;
  } | null,
  dialog: vi.fn(),
}));

vi.mock("../sessions/authState", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/features/account/api/api", () => ({
  accountApi: { me: async () => ({ provider: "google" }) },
}));
vi.mock("../export/AccountExportDialog", () => ({
  AccountExportDialog: (props: { open: boolean; google: boolean }) => {
    mocks.dialog(props);
    return props.open ? <div data-testid="export-dialog" /> : null;
  },
}));

import { AccountClosingNotice } from "./AccountClosingNotice";

describe("AccountClosingNotice", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.user = { id: "u1", email: "me@example.com", username: "me" };
    mocks.dialog.mockClear();
    useAccountClosing.setState({ deleteAt: null });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.getElementById("misty-notification-viewport")?.remove();
  });

  it("stays hidden while the account isn't closing", () => {
    act(() => root.render(<AccountClosingNotice />));
    expect(document.body.textContent).not.toContain("read-only");
  });

  it("says the account is read-only until the date and opens the export", async () => {
    useAccountClosing.setState({ deleteAt: "2026-12-01T15:00:00Z" });
    act(() => root.render(<AccountClosingNotice />));
    expect(document.body.textContent).toContain("read-only");
    expect(document.body.textContent).toContain("2026");
    const exportButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Export",
    );
    expect(exportButton).toBeTruthy();
    await act(async () => exportButton!.click());
    expect(document.querySelector('[data-testid="export-dialog"]')).toBeTruthy();
    expect(mocks.dialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, google: true }),
    );
  });
});
