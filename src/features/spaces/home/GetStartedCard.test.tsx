import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Space } from "../api/dto/entities";
import { GetStartedCard } from "./GetStartedCard";

const state = vi.hoisted(() => ({
  ready: new Set<string>(),
  agents: [] as { engine?: string; enabled: boolean }[],
  conversations: [] as { id: string; messages: { role: string; source?: string }[] }[],
  labChats: new Set<string>(),
}));

vi.mock("@/app/shell", () => ({ routes: { setup: "/setup" } }));
vi.mock("@/features/onboarding", () => ({
  startTour: vi.fn(),
  useTours: () => ({ loaded: true, seen: [], checklistHidden: false, hideChecklist: vi.fn() }),
}));
vi.mock("@/features/agents", () => ({
  isEngineId: (engine?: string) => Boolean(engine),
  EngineReadyProbe: ({
    engine,
    onReady,
  }: {
    engine: string;
    onReady(engine: string, ready: boolean): void;
  }) => {
    useEffect(() => onReady(engine, state.ready.has(engine)), [engine, onReady]);
    return null;
  },
  usePersonalAgentsStore: (pick: (s: unknown) => unknown) => pick({ agents: state.agents }),
  useMistyStore: (pick: (s: unknown) => unknown) => pick({ conversations: state.conversations }),
  useTutorChatIds: () => state.labChats,
  useTutorStore: (pick: (s: unknown) => unknown) => pick({ notebooks: {} }),
}));

const space = (patch: Partial<Space>): Space => ({
  id: "s1",
  is_default: false,
  owner_user_id: "me",
  name: "Home",
  role: "owner",
  member_count: 1,
  pending_count: 0,
  is_shared: false,
  created_at: "",
  updated_at: "",
  ...patch,
});

const show = (value: Space) =>
  render(
    <MemoryRouter>
      <GetStartedCard space={value} wroteDoc={false} />
    </MemoryRouter>,
  );
const done = (title: string) =>
  screen.getByText(title).closest("button")?.querySelector("[aria-label='Done']") ?? null;

afterEach(cleanup);

beforeEach(() => {
  state.ready = new Set();
  state.agents = [{ engine: "claude", enabled: true }];
  state.conversations = [];
  state.labChats = new Set();
});

it("ticks Set up an AI only once an engine is ready, not just installed", () => {
  const { unmount } = show(space({}));
  expect(done("Set up an AI")).toBeNull();
  unmount();
  state.ready = new Set(["claude"]);
  show(space({}));
  expect(done("Set up an AI")).not.toBeNull();
});

it("counts only the person's own messages outside the Lab's runs", () => {
  state.labChats = new Set(["job"]);
  state.conversations = [
    { id: "job", messages: [{ role: "user" }, { role: "assistant" }] },
    { id: "goal", messages: [{ role: "user", source: "continuation" }] },
  ];
  const { unmount } = show(space({}));
  expect(done("Ask your AI something")).toBeNull();
  unmount();
  state.conversations.push({ id: "mine", messages: [{ role: "user" }] });
  show(space({}));
  expect(done("Ask your AI something")).not.toBeNull();
});

it("shows Invite a friend only to the owner, before Write a doc, ticked by an invitation", () => {
  const { unmount } = show(space({ role: "member", member_count: 3 }));
  expect(screen.queryByText("Invite a friend")).toBeNull();
  unmount();
  const { unmount: again } = show(space({}));
  const order = screen
    .getAllByText(/^(Invite a friend|Write a doc)$/)
    .map((node) => node.textContent);
  expect(order).toEqual(["Invite a friend", "Write a doc"]);
  expect(done("Invite a friend")).toBeNull();
  again();
  show(space({ pending_count: 1 }));
  expect(done("Invite a friend")).not.toBeNull();
});
