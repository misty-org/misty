import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn(), generation: 1 }));
vi.mock("@/api/client", () => ({
  apiRequest: api.request,
  readApiSessionGeneration: () => api.generation,
}));
import { CommandUsageEstimate } from "./CommandUsageEstimate";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  api.request.mockReset();
  api.generation = 1;
});
const estimate = {
  available: true,
  allowed: true,
  usage: {
    command: {
      estimated_units: 1234,
      estimated_percentage: 0.12,
      maximum: 10000,
      maximum_percentage: 10,
    },
  },
};
describe("CommandUsageEstimate", () => {
  it("shows billing's values and distinguishes the draft from full execution", async () => {
    vi.useFakeTimers();
    api.request.mockResolvedValue(estimate);
    render(<CommandUsageEstimate text="Summarize this" model="selected" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText(/Draft estimate: 0.12%/)).toBeDefined();
    expect(screen.getByText(/History, attachments, and tool steps/)).toBeDefined();
    expect(api.request.mock.calls[0][0]).toBe("/billing/estimate");
    expect(JSON.parse(api.request.mock.calls[0][1].body)).toEqual({
      text: "Summarize this",
      model: "selected",
    });
  });
  it("does not display a stale draft or a previous account's estimate", async () => {
    vi.useFakeTimers();
    let resolve!: (value: typeof estimate) => void;
    api.request.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const view = render(<CommandUsageEstimate text="Old draft" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    api.generation = 2;
    view.rerender(<CommandUsageEstimate text="New draft" />);
    await act(async () => {
      resolve(estimate);
    });
    expect(screen.queryByText(/Draft estimate: 0.12%/)).toBeNull();
  });
  it("keeps unavailable estimates distinct from zero usage", async () => {
    vi.useFakeTimers();
    api.request.mockRejectedValue(new Error("offline"));
    render(<CommandUsageEstimate text="Hello" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText(/Usage estimate unavailable/)).toBeDefined();
  });
});
