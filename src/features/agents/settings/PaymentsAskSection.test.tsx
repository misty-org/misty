import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoticeViewport, resetNotices } from "@/shared/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  settings: vi.fn(),
  updatePaymentsAsk: vi.fn(),
}));

vi.mock("@/features/agents/runs/invocations/api", () => ({ aiSurfaceApi: api }));

import { PaymentsAskSection } from "./PaymentsAskSection";

describe("PaymentsAskSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.settings.mockResolvedValue({ settings: { payments_ask: true } });
  });

  afterEach(() => {
    cleanup();
    act(() => resetNotices());
  });

  it("loads the saved choice and saves a change through the server", async () => {
    api.updatePaymentsAsk.mockResolvedValue({ settings: { payments_ask: false } });
    render(<PaymentsAskSection />);

    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(toggle);

    expect(api.updatePaymentsAsk).toHaveBeenCalledWith(false);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
  });

  it("shows a plain notice when saving fails", async () => {
    api.updatePaymentsAsk.mockRejectedValue(new Error("pq: raw server failure"));
    // The failure is a notice, drawn where the app draws them.
    render(
      <>
        <NoticeViewport />
        <PaymentsAskSection />
      </>,
    );

    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    fireEvent.click(toggle);

    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toBe("This setting couldn’t be saved. Try again.");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});
