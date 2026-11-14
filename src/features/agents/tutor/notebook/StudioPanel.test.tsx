import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TutorActions } from "../TutorPage";
import { useTutorStore } from "../tutorStore";
import type { Deck, Guide, Notebook, TutorJob } from "../tutorTypes";
import { StudioPanel } from "./StudioPanel";

const fakes = vi.hoisted(() => ({
  startJob: vi.fn(),
  startRun: vi.fn(),
  retryJob: vi.fn(),
  dismissJob: vi.fn(),
}));

vi.mock("../tutorRuns", () => fakes);
vi.mock("../../conversations/state/useMistyStore", async () => {
  const { create } = await import("zustand");
  return { useMistyStore: create(() => ({ conversations: [] })) };
});
vi.mock("../../conversations/state/localChats", () => ({
  localChats: {
    saveTutor: () => Promise.resolve(),
    deleteTutor: () => Promise.resolve(),
    tutor: () => Promise.resolve([]),
  },
}));
vi.mock("../../page/useChatStatuses", () => ({ shortAgo: () => "now" }));

const { useMistyStore } = await import("../../conversations/state/useMistyStore");

const notebook = {
  id: "n1",
  title: "Volcanoes",
  sources: [],
  notes: [],
  transformations: [],
  chats: [],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
} as Notebook;

const at = (minute: number) => `2026-11-01T00:${String(minute).padStart(2, "0")}:00Z`;

const guide = (change: Partial<Guide> & Pick<Guide, "id" | "kind">): Guide => ({
  title: change.id,
  body: "",
  notebookId: "n1",
  createdAt: at(1),
  updatedAt: at(1),
  ...change,
});

const deck = (change: Partial<Deck> & Pick<Deck, "id">): Deck => ({
  title: change.id,
  cards: [],
  notebookId: "n1",
  createdAt: at(1),
  updatedAt: at(1),
  ...change,
});

const job = (change: Partial<TutorJob> & Pick<TutorJob, "id" | "kind" | "state">): TutorJob => ({
  title: `${change.id} title`,
  agentId: "a1",
  conversationId: `chat-${change.id}`,
  prompt: "",
  notebookId: "n1",
  createdAt: at(1),
  updatedAt: at(1),
  ...change,
});

let actions: TutorActions;
let props: {
  onCollapse: Mock<(collapsed: boolean) => void>;
  onView: Mock<(viewing?: { id: string; review?: boolean }) => void>;
  onError: Mock<(message: string) => void>;
};

function panel(options: { collapsed?: boolean; viewing?: { id: string; review?: boolean } } = {}) {
  return render(
    <StudioPanel
      notebook={notebook}
      actions={actions}
      collapsed={options.collapsed ?? false}
      viewing={options.viewing}
      onCollapse={props.onCollapse}
      onView={props.onView}
      onError={props.onError}
    />,
  );
}

const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  fakes.startJob.mockResolvedValue(undefined);
  fakes.retryJob.mockResolvedValue(undefined);
  fakes.dismissJob.mockResolvedValue(undefined);
  actions = { agentId: "a1", onChat: vi.fn(), onLearn: vi.fn(), open: vi.fn() };
  props = { onCollapse: vi.fn(), onView: vi.fn(), onError: vi.fn() };
  useTutorStore.setState({ accountId: "acct", jobs: {}, guides: {}, decks: {} });
  useMistyStore.setState({ conversations: [] });
});

afterEach(cleanup);

describe("making something", () => {
  it("offers every kind and says nothing is made yet", () => {
    panel();
    for (const label of [
      "Audio overview",
      "Video overview",
      "Mind map",
      "Reports",
      "Flashcards",
      "Quiz",
      "Slides",
      "Infographic",
      "Data table",
      "Teach me",
    ])
      expect(button(label)).toBeTruthy();
    expect(screen.getByText("Nothing made yet")).toBeTruthy();
  });

  it.each([
    ["Audio overview", "overview", "Audio overview: Volcanoes"],
    ["Video overview", "video", "Video overview: Volcanoes"],
    ["Mind map", "mindmap", "Mind map: Volcanoes"],
    ["Flashcards", "deck", "Flashcards: Volcanoes"],
    ["Quiz", "quiz", "Quiz: Volcanoes"],
    ["Slides", "slides", "Slides: Volcanoes"],
    ["Infographic", "infographic", "Infographic: Volcanoes"],
  ])("%s starts a %s run on the notebook's agent", (label, kind, title) => {
    panel();
    fireEvent.click(button(label));
    expect(fakes.startJob).toHaveBeenCalledTimes(1);
    const input = fakes.startJob.mock.calls[0][0];
    expect(input).toMatchObject({ kind, title, agentId: "a1", notebookId: "n1" });
    expect(input.prompt).toContain("Volcanoes");
  });

  it("lists the reports to choose from and starts the one chosen", () => {
    panel();
    fireEvent.click(button("Reports"));
    const chooser = screen.getByRole("group", { name: "Reports" });
    const names = within(chooser)
      .getAllByRole("button")
      .map((item) => item.textContent);
    expect(names).toEqual(
      expect.arrayContaining(["Study guide", "Briefing doc", "FAQ", "Timeline"]),
    );
    expect(names).not.toContain("Data table");

    fireEvent.click(within(chooser).getByRole("button", { name: "FAQ" }));
    expect(fakes.startJob.mock.calls[0][0]).toMatchObject({
      kind: "guide",
      report: "faq",
      title: "FAQ: Volcanoes",
    });
    expect(screen.queryByRole("group", { name: "Reports" })).toBeNull();
  });

  it("makes a data table as a report of its own", () => {
    panel();
    fireEvent.click(button("Data table"));
    expect(fakes.startJob.mock.calls[0][0]).toMatchObject({
      kind: "guide",
      report: "data-table",
      title: "Data table: Volcanoes",
    });
  });

  it("says why a run couldn't start", async () => {
    fakes.startJob.mockRejectedValueOnce(new Error("No engine is signed in."));
    panel();
    fireEvent.click(button("Quiz"));
    await vi.waitFor(() => expect(props.onError).toHaveBeenCalledWith("No engine is signed in."));
  });

  it("opens Teach me as a lesson chat", async () => {
    fakes.startRun.mockResolvedValue({ conversationId: "lesson-1", started: true });
    panel();
    fireEvent.click(button("Teach me"));
    expect(fakes.startRun.mock.calls[0][0]).toMatchObject({
      agentId: "a1",
      mode: "teach",
      background: false,
    });
    await vi.waitFor(() => expect(actions.onChat).toHaveBeenCalledWith("a1", "lesson-1"));
  });

  it("asks to wait when Teach me can't start over another turn", async () => {
    fakes.startRun.mockResolvedValue({ conversationId: "lesson-1", started: false });
    panel();
    fireEvent.click(button("Teach me"));
    await vi.waitFor(() =>
      expect(props.onError).toHaveBeenCalledWith(
        "Another turn is working. Try again when it finishes.",
      ),
    );
    expect(actions.onChat).not.toHaveBeenCalled();
  });

  it("starts runs from the folded rail too, and unfolds", () => {
    panel({ collapsed: true });
    fireEvent.click(button("Flashcards"));
    expect(fakes.startJob.mock.calls[0][0]).toMatchObject({ kind: "deck" });
    fireEvent.click(button("Show Create"));
    expect(props.onCollapse).toHaveBeenCalledWith(false);
  });
});

describe("what is being made", () => {
  it("shows each run's state, and only this notebook's Create runs", () => {
    useTutorStore.setState({
      jobs: {
        a: job({ id: "a", kind: "deck", state: "running", title: "Flashcards: Lava" }),
        b: job({ id: "b", kind: "quiz", state: "queued", title: "Quiz: Lava" }),
        c: job({ id: "c", kind: "research", state: "running", title: "Finding sources: Lava" }),
        d: job({ id: "d", kind: "deck", state: "running", notebookId: "n2", title: "Elsewhere" }),
        e: job({ id: "e", kind: "slides", state: "done", title: "Slides: Lava" }),
      },
    });
    panel();
    expect(screen.getByText("Flashcards: Lava")).toBeTruthy();
    expect(screen.getByText("Making")).toBeTruthy();
    expect(screen.getByText("Waiting for a turn to end")).toBeTruthy();
    expect(screen.queryByText("Finding sources: Lava")).toBeNull();
    expect(screen.queryByText("Elsewhere")).toBeNull();
    expect(screen.queryByText("Slides: Lava")).toBeNull();
    expect(screen.queryByText("Nothing made yet")).toBeNull();
  });

  it("calls a queued run whose turn has begun Making", () => {
    useTutorStore.setState({ jobs: { b: job({ id: "b", kind: "quiz", state: "queued" }) } });
    // A stand-in chat: only its id and that it has a turn matter here.
    useMistyStore.setState({
      conversations: [{ id: "chat-b", messages: [{ id: "q", role: "user" }] }],
    } as never);
    panel();
    expect(screen.getByText("Making")).toBeTruthy();
  });

  it("shows a failed run's reason with Try again and Dismiss", () => {
    const failed = job({
      id: "f",
      kind: "deck",
      state: "failed",
      error: "The reply had nothing Misty could use.",
    });
    useTutorStore.setState({ jobs: { f: failed } });
    panel();
    expect(screen.getByText("The reply had nothing Misty could use.")).toBeTruthy();
    fireEvent.click(button("Try again"));
    expect(fakes.retryJob).toHaveBeenCalledWith(failed);
    fireEvent.click(button("Dismiss"));
    expect(fakes.dismissJob).toHaveBeenCalledWith(failed);
  });

  it("opens a run's chat", () => {
    useTutorStore.setState({ jobs: { a: job({ id: "a", kind: "deck", state: "running" }) } });
    panel();
    fireEvent.click(screen.getByText("a title"));
    expect(actions.onChat).toHaveBeenCalledWith("a1", "chat-a");
  });
});

describe("what was made", () => {
  it("lists this notebook's things newest first, each with what it is", () => {
    useTutorStore.setState({
      guides: {
        old: guide({ id: "old", kind: "guide", report: "faq", title: "Lava FAQ", createdAt: at(1) }),
        map: guide({ id: "map", kind: "mindmap", title: "Lava map", createdAt: at(3) }),
        other: guide({ id: "other", kind: "slides", title: "Not here", notebookId: "n2" }),
      },
      decks: {
        cards: deck({
          id: "cards",
          title: "Lava cards",
          createdAt: at(2),
          cards: [
            { id: "1", front: "a", back: "b", review: {} },
            { id: "2", front: "c", back: "d", review: {} },
          ] as Deck["cards"],
        }),
      },
    });
    panel();
    const titles = ["Lava map", "Lava cards", "Lava FAQ"];
    const rows = titles.map((title) => screen.getByRole("button", { name: new RegExp(title) }));
    expect(rows.map((row) => row.textContent)).toEqual([
      "Lava mapMind map · now",
      "Lava cards2 cards · now",
      "Lava FAQFAQ · now",
    ]);
    expect(screen.queryByText("Not here")).toBeNull();

    fireEvent.click(rows[1]);
    expect(props.onView).toHaveBeenCalledWith({ id: "cards" });
  });

  it.each([
    [guide({ id: "s", kind: "slides", title: "Lava deck", body: "# One\n---\n# Two" }), "1 / 2"],
    [guide({ id: "m", kind: "mindmap", title: "Lava map", map: { label: "Lava" } }), "Lava"],
    [
      guide({
        id: "q",
        kind: "quiz",
        title: "Lava quiz",
        questions: [{ question: "Hot?", choices: ["Yes", "No"], answer: 0 }],
      }),
      "Hot?",
    ],
    [
      guide({
        id: "v",
        kind: "video",
        title: "Lava film",
        scenes: [
          { heading: "One", narration: "First." },
          { heading: "Two", narration: "Second." },
        ],
      }),
      "First.",
    ],
    [
      guide({ id: "o", kind: "overview", title: "Lava talk", script: [{ speaker: 0, text: "Hi" }] }),
      "No audio yet",
    ],
  ])("opens a made thing in place (%#)", (item, shows) => {
    useTutorStore.setState({ guides: { [item.id]: item } });
    panel({ viewing: { id: item.id } });
    expect(screen.getAllByText(shows).length).toBeGreaterThan(0);
    fireEvent.click(button("Back to Create"));
    expect(props.onView).toHaveBeenCalledWith(undefined);
  });

  it("opens a deck, and reviews it", () => {
    const made = useTutorStore.getState().newDeck({ title: "Lava cards", notebookId: "n1" }, [
      { front: "Magma?", back: "Molten rock" },
    ]);
    const view = panel({ viewing: { id: made.id } });
    fireEvent.click(button("Review 1"));
    expect(props.onView).toHaveBeenCalledWith({ id: made.id, review: true });

    view.unmount();
    panel({ viewing: { id: made.id, review: true } });
    expect(screen.getByText("Magma?")).toBeTruthy();
    expect(button("Show answer")).toBeTruthy();
  });

  it("shows the list again when what was open is gone", () => {
    panel({ viewing: { id: "deleted" } });
    expect(screen.getByText("Nothing made yet")).toBeTruthy();
  });

  it("keeps the list current as a run finishes", () => {
    useTutorStore.setState({ jobs: { a: job({ id: "a", kind: "slides", state: "running" }) } });
    panel();
    act(() =>
      useTutorStore.setState({
        jobs: { a: job({ id: "a", kind: "slides", state: "done", resultId: "s" }) },
        guides: { s: guide({ id: "s", kind: "slides", title: "Lava deck" }) },
      }),
    );
    expect(screen.queryByText("Making")).toBeNull();
    expect(screen.getByText("Lava deck")).toBeTruthy();
  });
});
