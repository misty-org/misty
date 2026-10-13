import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ConnectedApp } from "./api";
import { AppAccountsCard, groupApps } from "./ConnectedAppRows";

afterEach(cleanup);

const gmail = (id: string, account: string): ConnectedApp => ({
  id,
  app: "gmail",
  name: "Gmail",
  account,
  status: "active",
  created_at: "2026-10-16T10:00:00Z",
});

it("shows each account of the app without per-Space choices", () => {
  const [group] = groupApps([gmail("ca_work", "me@work.example"), gmail("ca_home", "me@home.example")]);
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
  expect(screen.getByText("me@work.example")).toBeTruthy();
  expect(screen.getByText("me@home.example")).toBeTruthy();
  expect(screen.queryByText(/Space/)).toBeNull();
});
