import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  requestLink: vi.fn(async () => ({ url: "https://connect.example.test" })),
  decide: vi.fn(),
  open: vi.fn(async () => {}),
}));
vi.mock("./api", () => ({
  appsApi: { request: mocks.request, requestLink: mocks.requestLink, decide: mocks.decide },
}));
vi.mock("@/shared/platform/openExternalLink", () => ({ openExternalLink: mocks.open }));
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
afterEach(() => vi.useRealTimers());

it("checks for the finished sign-in and reports the connected card", async () => {
  const onResolved = vi.fn();
  mocks.request
    .mockResolvedValueOnce({ request: connect })
    .mockResolvedValueOnce({ request: { ...connect, state: "connected" } });
  render(<AppRequestCard request={connect} onResolved={onResolved} />);
  expect(mocks.request).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Connect/ })));
  expect(mocks.open).toHaveBeenCalledWith("https://connect.example.test");
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(onResolved).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ state: "connected" }));
  expect(screen.getByText("Connected")).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(9_000));
  expect(mocks.request).toHaveBeenCalledTimes(2);
});

it("reports an approval decision", async () => {
  const onResolved = vi.fn();
  const approval = { ...connect, kind: "approve" as const, title: "Send email" };
  mocks.decide.mockResolvedValueOnce({ request: { ...approval, state: "approved" } });
  render(<AppRequestCard request={approval} onResolved={onResolved} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Approve/ })));
  expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ state: "approved" }));
});
