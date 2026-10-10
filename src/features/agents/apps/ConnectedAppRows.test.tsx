import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ConnectedApp } from "./api";
import { AppAccountsCard, groupApps } from "./ConnectedAppRows";

afterEach(cleanup);

const gmail = (id: string, account: string, spaces: ConnectedApp["spaces"]): ConnectedApp => ({
  id,
  app: "gmail",
  name: "Gmail",
  account,
  status: "active",
  created_at: "2026-10-16T10:00:00Z",
  spaces,
});

it("shows each account with the Spaces that use it", () => {
  const [group] = groupApps([
    gmail("ca_work", "me@work.example", [{ id: "space_work", name: "Work", personal: false }]),
    gmail("ca_home", "me@home.example", [{ id: "space_home", name: "Personal", personal: true }]),
    gmail("ca_old", "old@home.example", []),
  ]);
  render(
    <AppAccountsCard
      group={group}
      busy={false}
      onDone={vi.fn()}
      onAdd={vi.fn()}
      onReconnect={vi.fn()}
      onDisconnect={vi.fn()}
    />,
  );
  const trees = screen.getAllByRole("list", { name: "Used in" });
  expect(trees).toHaveLength(2);
  expect(within(trees[0]).getByText("Work")).toBeTruthy();
  expect(within(trees[0]).queryByText("Personal")).toBeNull();
  expect(within(trees[1]).getByText("Personal")).toBeTruthy();
  expect(screen.getByText("Not used in any Space")).toBeTruthy();
});
