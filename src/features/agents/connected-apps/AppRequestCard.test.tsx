import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("./api", () => ({
  appsApi: { request: mocks.request, decide: mocks.decide },
}));
import { AppRequestCard } from "./AppRequestCard";
import type { AppRequest } from "./api";

const connect: AppRequest = {
  id: "apprq-1",
  kind: "connect",
  subject: "gmail",
  title: "Connect Gmail",
  summary: "Sign in to Gmail so Misty can continue.",
  state: "pending",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("lets an old Connect card only be put aside", async () => {
  mocks.decide.mockResolvedValueOnce({ request: { ...connect, state: "declined" } });
  render(<AppRequestCard request={connect} />);
  expect(screen.queryByRole("button", { name: /Connect/ })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not now" })));
  expect(mocks.decide).toHaveBeenCalledWith("apprq-1", "deny");
});

it("reports an approval decision", async () => {
  const onResolved = vi.fn();
  const approval = { ...connect, kind: "approve" as const, title: "Send email" };
  mocks.decide.mockResolvedValueOnce({ request: { ...approval, state: "approved" } });
  render(<AppRequestCard request={approval} onResolved={onResolved} />);
  expect(screen.queryByRole("button", { name: /Accept and remember/ })).toBeNull();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Accept and continue/ })),
  );
  expect(mocks.decide).toHaveBeenCalledWith("apprq-1", "continue");
  expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ state: "approved" }));
});

it("names the exact scope it would remember, from the server", async () => {
  const approval: AppRequest = {
    ...connect,
    kind: "approve",
    title: "Gmail · Send email",
    rememberable: true,
    rememberLabel: "act in Gmail (me@example.test)",
    permissionMode: "auto",
  };
  mocks.decide.mockResolvedValueOnce({ request: { ...approval, state: "approved" } });
  render(<AppRequestCard request={approval} />);
  expect(screen.getByText(/Remember: act in Gmail \(me@example.test\)/)).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Accept and remember/ })),
  );
  expect(mocks.decide).toHaveBeenCalledWith("apprq-1", "remember");
});

it("says remembering applies when the chat's mode works without asking", () => {
  const payment: AppRequest = {
    ...connect,
    kind: "approve",
    title: "Stripe · Create payment",
    rememberable: true,
    rememberLabel: "pay through Stripe up to 5.00 USD",
    permissionMode: "ask",
    paymentCap: { max_amount_minor: 500, currency: "usd" },
  };
  render(<AppRequestCard request={payment} />);
  expect(screen.getByText(/each payment up to 5.00 USD/)).toBeTruthy();
  expect(
    screen.getByText(/remembered approvals apply in a mode that works without asking/),
  ).toBeTruthy();
});

it("denies", async () => {
  const approval = { ...connect, kind: "approve" as const, title: "Delete file" };
  mocks.decide.mockResolvedValueOnce({ request: { ...approval, state: "declined" } });
  render(<AppRequestCard request={approval} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Deny" })));
  expect(mocks.decide).toHaveBeenCalledWith("apprq-1", "deny");
  expect(screen.getByText("Denied")).toBeTruthy();
});
