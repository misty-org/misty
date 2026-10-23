import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAgentBrowser } from "../agentBrowser/agentBrowserStore";
import { LedgerTable } from "./LedgerTable";
import type { LedgerRow } from "./ledger";

const rows: LedgerRow[] = [
  {
    id: "r1",
    requirement: "Open site A",
    state: "done",
    evidence: { kind: "tab", ref: "https://a.example" },
  },
  { id: "r2", requirement: "Open site B", state: "failed", reason: "bad link" },
  { id: "r3", requirement: "Sign in to C", state: "blocked", reason: "captcha", needs: "takeover" },
];

function mount(onResume = vi.fn(), onChange = vi.fn(), working = false) {
  render(
    <LedgerTable
      rows={rows}
      conversationId="chat-1"
      working={working}
      onResume={onResume}
      onChange={onChange}
    />,
  );
  return { onResume, onChange };
}

afterEach(() => {
  cleanup();
  useAgentBrowser.setState({ chats: {}, tabs: {} });
});

it("shows only the open rows over a count of what is done", () => {
  mount();
  expect(screen.getByText(/1 of 3 done/)).toBeTruthy();
  expect(screen.queryByText("Open site A")).toBeNull();
  expect(screen.getByText("Open site B")).toBeTruthy();
  expect(screen.getByText("Sign in to C")).toBeTruthy();
});

it("retries one row, or every open row", () => {
  const { onResume } = mount();
  fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]!);
  expect(onResume).toHaveBeenLastCalledWith(rows, ["r2"]);
  fireEvent.click(screen.getByRole("button", { name: "Retry unfinished" }));
  expect(onResume).toHaveBeenLastCalledWith(rows);
});

it("sends a hint with the row it was typed for", () => {
  const { onResume } = mount();
  fireEvent.click(screen.getAllByRole("button", { name: "Retry with a hint" })[0]!);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "use b.example/home" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const [sent, only] = onResume.mock.lastCall!;
  expect(only).toEqual(["r2"]);
  expect(sent.find((row: LedgerRow) => row.id === "r2")).toMatchObject({
    hint: "use b.example/home",
  });
});

it("skips a row, saving it as skipped", () => {
  const { onChange } = mount();
  fireEvent.click(screen.getAllByRole("button", { name: "Skip" })[0]!);
  expect(onChange.mock.lastCall![0].find((row: LedgerRow) => row.id === "r2")).toMatchObject({
    state: "skipped",
  });
});

it("hands the browser over for a row that needs the person, then continues it", () => {
  const { onResume } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Take over" }));
  expect(useAgentBrowser.getState().chats["chat-1"]?.expanded ?? true).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(onResume).toHaveBeenLastCalledWith(rows, ["r3"]);
});

it("disables the actions while a run is working", () => {
  mount(vi.fn(), vi.fn(), true);
  expect(screen.getAllByRole("button", { name: "Retry" })[0]!.hasAttribute("disabled")).toBe(true);
});
