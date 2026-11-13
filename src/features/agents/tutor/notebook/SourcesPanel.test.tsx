import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTutorStore } from "../tutorStore";
import type { Notebook, TutorJob } from "../tutorTypes";
import { SourcesPanel } from "./SourcesPanel";

const runs = vi.hoisted(() => ({ retryJob: vi.fn(), dismissJob: vi.fn(), startJob: vi.fn() }));
vi.mock("../tutorRuns", () => ({
  retryJob: (job: TutorJob) => (runs.retryJob(job), Promise.resolve(job)),
  dismissJob: (job: TutorJob) => (runs.dismissJob(job), Promise.resolve()),
  startJob: runs.startJob,
}));

const notebook: Notebook = {
  id: "n1",
  title: "Volcanoes",
  sources: [],
  notes: [],
  transformations: [],
  chats: [],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
} as Notebook;

const job = (state: TutorJob["state"]): TutorJob => ({
  id: `job-${state}`,
  kind: "research",
  title: "Finding sources: lava",
  agentId: "a1",
  conversationId: `chat-${state}`,
  prompt: "",
  notebookId: "n1",
  state,
  error: "The reply had nothing Misty could use.",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
});

const panel = (onAdd = vi.fn()) =>
  render(
    <SourcesPanel
      notebook={notebook}
      agentId="a1"
      collapsed={false}
      onCollapse={vi.fn()}
      onAdd={onAdd}
      onOpen={vi.fn()}
      onNewNote={vi.fn()}
      onError={vi.fn()}
    />,
  );

afterEach(cleanup);

it("shows a failed search for sources in one line, with Try again", () => {
  const failed = job("failed");
  useTutorStore.setState({ jobs: { [failed.id]: failed } });
  panel();
  expect(screen.getByRole("alert").textContent).toContain("Couldn’t find sources for “lava”");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(runs.retryJob).toHaveBeenCalledWith(failed);
  expect(screen.queryByText("No sources yet")).toBeNull();
});

it("shows one empty state with the one Add sources button while there is nothing", () => {
  useTutorStore.setState({ jobs: {} });
  const onAdd = vi.fn();
  panel(onAdd);
  expect(screen.getByRole("heading", { name: "No sources yet" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sources" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add sources" }));
  expect(onAdd).toHaveBeenCalled();
});
