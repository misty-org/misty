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
  unusableReply: "The reply had nothing Misty could use.",
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
  runId: `run-${state}`,
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

it("says why a search failed when the reason says what to do", () => {
  const failed = { ...job("failed"), error: "Pick a default engine in Settings › Agents." };
  useTutorStore.setState({ jobs: { [failed.id]: failed } });
  panel();
  expect(screen.getByRole("alert").textContent).toContain(
    "Pick a default engine in Settings › Agents.",
  );
});

it("tries a failed search again on the default engine", async () => {
  const failed = { ...job("failed"), agentId: "personal_misty" };
  useTutorStore.setState({ jobs: { [failed.id]: failed } });
  panel();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await vi.waitFor(() => expect(runs.retryJob).toHaveBeenCalledWith(failed));
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
