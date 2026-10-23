import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), revoke: vi.fn(), revokeAll: vi.fn() }));
vi.mock("@/features/agents/grants/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  grantsApi: { list: mocks.list, revoke: mocks.revoke, revokeAll: mocks.revokeAll },
}));
vi.mock("@/shared/lib/confirmAction", () => ({ confirmAction: vi.fn(async () => true) }));
import { AgentGrantsSection } from "./AgentGrantsSection";

afterEach(cleanup);

const push = {
  id: "grant_1",
  agent_id: "agent_1",
  agent_name: "Builder",
  action: "git.push",
  scope_kind: "repo",
  scope_id: "misty-org/misty",
  label: "Push to misty-org/misty",
  created_at: "2026-10-01T00:00:00Z",
  use_count: 0,
};

it("shows a skeleton first, then grants by agent, and revokes one", async () => {
  let resolve!: (value: { grants: (typeof push)[] }) => void;
  mocks.list.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  render(<AgentGrantsSection />);
  expect(screen.getByRole("status", { name: "Remembered approvals" })).toBeTruthy();
  expect(screen.queryByText(/Loading/)).toBeNull();
  await act(async () => resolve({ grants: [push] }));
  expect(screen.getByText("Push to misty-org/misty")).toBeTruthy();
  expect(screen.getByText(/Builder · Not used yet/)).toBeTruthy();
  mocks.revoke.mockResolvedValueOnce(undefined);
  mocks.list.mockResolvedValueOnce({ grants: [] });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Revoke" })));
  expect(mocks.revoke).toHaveBeenCalledWith("grant_1");
  expect(screen.queryByText("Push to misty-org/misty")).toBeNull();
});

it("revokes every grant for an agent", async () => {
  mocks.list
    .mockResolvedValueOnce({ grants: [push, { ...push, id: "grant_2", label: "Merge it" }] })
    .mockResolvedValueOnce({ grants: [] });
  mocks.revokeAll.mockResolvedValueOnce({ revoked: 1 });
  render(<AgentGrantsSection />);
  await act(async () => {});
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Revoke all" })));
  expect(mocks.revokeAll).toHaveBeenCalledWith("agent_1");
});

it("explains a failed load in plain language", async () => {
  mocks.list.mockRejectedValueOnce(new Error("500 internal"));
  render(<AgentGrantsSection />);
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toMatch(/couldn’t load your remembered approvals/);
  expect(screen.queryByText(/500/)).toBeNull();
});
