import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckView, ReviewSession } from "../TutorDecks";
import { OverviewView, QuizView } from "../TutorGuides";
import { useTutorStore } from "../tutorStore";
import type { Deck, Guide } from "../tutorTypes";
import { MindMapView, SlidesView } from "./StudioViews";
import { InfographicView, VideoView } from "./VideoView";
import type * as VideoExport from "./videoExport";

/** The viewers Create opens what it made in: each one's controls, on what an engine wrote. */

const fakes = vi.hoisted(() => ({
  confirm: vi.fn(),
  makeOverviewAudio: vi.fn(),
  overviewAudioUrl: vi.fn(),
  deleteOverviewAudio: vi.fn(),
  makeVideoAudio: vi.fn(),
  deleteVideoAudio: vi.fn(),
  sceneAudioBytes: vi.fn(),
  recordVideo: vi.fn(),
  saveBytes: vi.fn(),
}));

vi.mock("@/shared/lib/confirmAction", () => ({ confirmAction: fakes.confirm }));
vi.mock("../tutorRuns", () => ({ startJob: vi.fn() }));
vi.mock("../tutorAudio", () => ({
  makeOverviewAudio: fakes.makeOverviewAudio,
  overviewAudioUrl: fakes.overviewAudioUrl,
  deleteOverviewAudio: fakes.deleteOverviewAudio,
  makeVideoAudio: fakes.makeVideoAudio,
  deleteVideoAudio: fakes.deleteVideoAudio,
  sceneAudioBytes: fakes.sceneAudioBytes,
}));
vi.mock("./videoExport", async (actual) => ({
  ...(await actual<typeof VideoExport>()),
  recordVideo: fakes.recordVideo,
  saveBytes: fakes.saveBytes,
}));
vi.mock("../../conversations/state/localChats", () => ({
  localChats: {
    saveTutor: () => Promise.resolve(),
    deleteTutor: () => Promise.resolve(),
    tutor: () => Promise.resolve([]),
  },
}));

const guide = (change: Partial<Guide> & Pick<Guide, "kind">): Guide => ({
  id: `${change.kind}-1`,
  title: "Lava",
  body: "",
  notebookId: "n1",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...change,
});

const button = (name: string) => screen.getByRole("button", { name });
const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fakes.confirm.mockResolvedValue(true);
  fakes.saveBytes.mockResolvedValue(true);
  fakes.overviewAudioUrl.mockResolvedValue("blob:overview");
  useTutorStore.setState({ accountId: "acct", guides: {}, decks: {}, jobs: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("slides", () => {
  const deck = guide({
    kind: "slides",
    body: "# Lava\n\n- It is hot\n\nNotes: Start with a question.\n\n---\n\n## Flows\n\n- Slow",
  });

  it("shows one slide at a time with its notes, by button or arrow key", () => {
    render(<SlidesView deck={deck} onClose={onClose} />);
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(screen.getByText("It is hot")).toBeTruthy();
    expect(screen.getByText("Start with a question.")).toBeTruthy();
    expect(button("Previous slide").hasAttribute("disabled")).toBe(true);

    fireEvent.click(button("Next slide"));
    expect(screen.getByText("2 / 2")).toBeTruthy();
    expect(screen.getByText("Slow")).toBeTruthy();
    expect(screen.queryByText("Start with a question.")).toBeNull();
    expect(button("Next slide").hasAttribute("disabled")).toBe(true);

    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 2")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  it("deletes the deck once the person agrees", async () => {
    useTutorStore.getState().saveGuide(deck);
    render(<SlidesView deck={deck} onClose={onClose} />);
    fireEvent.click(button("Delete"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useTutorStore.getState().guides[deck.id]).toBeUndefined();
  });

  it("keeps the deck when the person says no", async () => {
    fakes.confirm.mockResolvedValue(false);
    useTutorStore.getState().saveGuide(deck);
    render(<SlidesView deck={deck} onClose={onClose} />);
    fireEvent.click(button("Delete"));
    await vi.waitFor(() => expect(fakes.confirm).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(useTutorStore.getState().guides[deck.id]).toBeTruthy();
  });
});

describe("mind map", () => {
  const map = guide({
    kind: "mindmap",
    map: {
      label: "Lava",
      children: [
        {
          label: "Kinds",
          children: [{ label: "Pahoehoe", children: [{ label: "Ropy surface" }] }],
        },
        { label: "Temperature" },
      ],
    },
  });

  it("opens two levels and unfolds the rest on request", () => {
    render(<MindMapView map={map} onClose={onClose} />);
    expect(screen.getByText("Kinds")).toBeTruthy();
    expect(screen.getByText("Temperature")).toBeTruthy();
    expect(screen.getByText("Pahoehoe")).toBeTruthy();
    expect(screen.queryByText("Ropy surface")).toBeNull();

    fireEvent.click(button("Unfold Pahoehoe"));
    expect(screen.getByText("Ropy surface")).toBeTruthy();

    fireEvent.click(button("Fold Kinds"));
    expect(screen.queryByText("Pahoehoe")).toBeNull();
  });
});

describe("quiz", () => {
  const quiz = guide({
    kind: "quiz",
    questions: [
      { question: "Is lava hot?", choices: ["Yes", "No"], answer: 0, explanation: "Very." },
      { question: "Is lava cold?", choices: ["Yes", "No"], answer: 1 },
    ],
  });

  it("checks once every question is answered, scores it and keeps the score", () => {
    useTutorStore.getState().saveGuide(quiz);
    render(<QuizView quiz={quiz} onClose={onClose} />);
    const [hotYes, , coldYes] = screen.getAllByRole("radio");
    expect(button("Check answers").hasAttribute("disabled")).toBe(true);

    fireEvent.click(hotYes);
    expect(button("Check answers").hasAttribute("disabled")).toBe(true);
    fireEvent.click(coldYes);
    fireEvent.click(button("Check answers"));

    expect(screen.getByRole("status").textContent).toBe("1 of 2 right");
    expect(screen.getByText("Very.")).toBeTruthy();
    expect(hotYes.getAttribute("data-verdict")).toBe("right");
    expect(coldYes.getAttribute("data-verdict")).toBe("wrong");
    expect(useTutorStore.getState().guides[quiz.id].lastScore).toBe(1);

    fireEvent.click(button("Try again"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(button("Check answers").hasAttribute("disabled")).toBe(true);
  });
});

describe("audio overview", () => {
  const script = [
    { speaker: 0 as const, text: "Welcome to the show." },
    { speaker: 1 as const, text: "Let's talk lava." },
  ];

  it("shows the script while the audio is spoken", () => {
    render(
      <OverviewView
        overview={guide({ kind: "overview", script, audio: { state: "making" } })}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("Speaking the script")).toBeTruthy();
    expect(button("Make audio").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Welcome to the show.")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("makes the audio again when it failed", () => {
    const overview = guide({
      kind: "overview",
      script,
      audio: { state: "failed", error: "No voice" },
    });
    render(<OverviewView overview={overview} onClose={onClose} />);
    expect(screen.getByText("No audio yet")).toBeTruthy();
    fireEvent.click(button("Make audio"));
    expect(fakes.makeOverviewAudio).toHaveBeenCalledWith(overview.id);
  });

  it("plays the audio once it is ready", async () => {
    const overview = guide({ kind: "overview", script, audio: { state: "ready", seconds: 30 } });
    const { container } = render(<OverviewView overview={overview} onClose={onClose} />);
    await vi.waitFor(() =>
      expect(container.querySelector("audio")?.getAttribute("src")).toBe("blob:overview"),
    );
    expect(fakes.overviewAudioUrl).toHaveBeenCalledWith(overview.id);
    expect(button("Speak again")).toBeTruthy();
  });

  it("deletes its audio with it", async () => {
    const overview = guide({ kind: "overview", script });
    useTutorStore.getState().saveGuide(overview);
    render(<OverviewView overview={overview} onClose={onClose} />);
    fireEvent.click(button("Delete overview"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fakes.deleteOverviewAudio).toHaveBeenCalledWith(overview.id);
    expect(useTutorStore.getState().guides[overview.id]).toBeUndefined();
  });
});

describe("flashcards", () => {
  const made = () =>
    useTutorStore.getState().newDeck({ title: "Lava cards", notebookId: "n1" }, [
      { front: "Magma?", back: "Molten rock" },
      { front: "Vent?", back: "An opening" },
    ]);
  const current = (id: string) => useTutorStore.getState().decks[id];

  function OpenDeck({ id, onReview = vi.fn() }: { id: string; onReview?: () => void }) {
    const deck = useTutorStore((state) => state.decks[id]);
    return deck ? <DeckView deck={deck} onClose={onClose} onReview={onReview} /> : null;
  }

  it("counts what is due and adds, edits and deletes cards", () => {
    const deck = made();
    const onReview = vi.fn();
    render(<OpenDeck id={deck.id} onReview={onReview} />);
    fireEvent.click(button("Review 2"));
    expect(onReview).toHaveBeenCalled();

    const [front, back] = screen.getAllByRole("textbox", { name: /Front|Back/ });
    fireEvent.change(front, { target: { value: "Crater?" } });
    fireEvent.change(back, { target: { value: "A bowl" } });
    fireEvent.click(button("Add card"));
    expect(current(deck.id).cards.map((card) => card.front)).toEqual(["Magma?", "Vent?", "Crater?"]);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit card" })[0]);
    const editor = screen.getAllByRole("textbox", { name: "Front" })[1];
    fireEvent.change(editor, { target: { value: "Magma is?" } });
    fireEvent.click(button("Save"));
    expect(current(deck.id).cards[0].front).toBe("Magma is?");

    fireEvent.click(screen.getAllByRole("button", { name: "Delete card" })[1]);
    expect(current(deck.id).cards.map((card) => card.front)).toEqual(["Magma is?", "Crater?"]);
  });

  it("renames the deck when the name loses focus", () => {
    const deck = made();
    render(<OpenDeck id={deck.id} />);
    const name = screen.getByRole("textbox", { name: "Deck name" });
    fireEvent.change(name, { target: { value: "Volcano cards" } });
    fireEvent.blur(name);
    expect(current(deck.id).title).toBe("Volcano cards");
  });

  it("reviews due cards one at a time, bringing back a missed one", () => {
    const deck = made();
    const onDone = vi.fn();
    function Review() {
      const live = useTutorStore((state) => state.decks[deck.id]);
      return <ReviewSession decks={[live]} onDone={onDone} />;
    }
    render(<Review />);

    expect(screen.getByText("2 left")).toBeTruthy();
    expect(screen.getByText("Magma?")).toBeTruthy();
    expect(screen.queryByText("Molten rock")).toBeNull();
    fireEvent.click(button("Show answer"));
    expect(screen.getByText("Molten rock")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Again/ }));

    expect(screen.getByText("Vent?")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: " " });
    fireEvent.keyDown(document.body, { key: "3" });

    expect(screen.getByText("Magma?")).toBeTruthy();
    expect(screen.getByText("1 left")).toBeTruthy();
    fireEvent.click(button("Show answer"));
    fireEvent.click(screen.getByRole("button", { name: /^Good/ }));

    expect(screen.getByText("Reviewed 3 cards.")).toBeTruthy();
    const cards = current(deck.id).cards;
    expect(cards.every((card) => Date.parse(card.review.due) > Date.now())).toBe(true);
    expect(cards.find((card) => card.front === "Magma?")?.review.lapses).toBe(1);
    fireEvent.click(button("Done"));
    expect(onDone).toHaveBeenCalled();
  });

  it("says when nothing is due", () => {
    const deck: Deck = { ...made(), cards: [] };
    render(<ReviewSession decks={[deck]} onDone={vi.fn()} />);
    expect(screen.getByText("Nothing is due.")).toBeTruthy();
  });
});

describe("video overview", () => {
  const video = guide({
    kind: "video",
    title: "Lava film",
    scenes: [
      {
        heading: "What lava is",
        narration: "Lava is molten rock that reaches the surface.",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"></svg>',
      },
      { heading: "How it flows", points: ["Slowly", "Downhill"], narration: "It flows downhill." },
    ],
    audio: { state: "failed", error: "No voice" },
  });

  it("steps through scenes, drawing or falling back to the points, with captions", () => {
    render(<VideoView video={video} onClose={onClose} />);
    expect(screen.getByRole("img", { name: "What lava is" })).toBeTruthy();
    expect(screen.getByText("Lava is molten rock that reaches the surface.")).toBeTruthy();
    expect(screen.getByText(/Scene 1 of 2/)).toBeTruthy();

    fireEvent.click(button("Next scene"));
    expect(screen.getByText(/Scene 2 of 2/)).toBeTruthy();
    expect(screen.getByText("Downhill")).toBeTruthy();
    expect(screen.getByText("It flows downhill.")).toBeTruthy();
  });

  it("plays without a voice at reading pace, and stops at the end", () => {
    vi.useFakeTimers();
    render(<VideoView video={video} onClose={onClose} />);
    fireEvent.click(button("Play"));
    expect(button("Pause")).toBeTruthy();
    // "Lava is molten rock that reaches the surface." reads in about 4.6 seconds.
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText(/Scene 2 of 2/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(5_000));
    expect(button("Play")).toBeTruthy();
    expect(fakes.sceneAudioBytes).not.toHaveBeenCalled();
  });

  it("makes the narration again when it failed", () => {
    render(<VideoView video={video} onClose={onClose} />);
    fireEvent.click(button("Make narration"));
    expect(fakes.makeVideoAudio).toHaveBeenCalledWith(video.id);
  });

  it("records the video and asks where to save it", async () => {
    const blob = new Blob(["video"]);
    fakes.recordVideo.mockResolvedValue({ blob, extension: "mp4" });
    render(<VideoView video={video} onClose={onClose} />);
    fireEvent.click(button("Save as a video"));
    await vi.waitFor(() =>
      expect(fakes.saveBytes).toHaveBeenCalledWith(blob, "Lava film", "mp4", "Video"),
    );
    expect(fakes.recordVideo.mock.calls[0][0]).toBe(video);
  });

  it("saves nothing when recording fails", async () => {
    fakes.recordVideo.mockRejectedValue(new Error("This system can't record video."));
    render(<VideoView video={video} onClose={onClose} />);
    fireEvent.click(button("Save as a video"));
    await vi.waitFor(() =>
      expect(button("Save as a video").hasAttribute("disabled")).toBe(false),
    );
    expect(fakes.saveBytes).not.toHaveBeenCalled();
  });

  it("deletes its narration with it", async () => {
    useTutorStore.getState().saveGuide(video);
    render(<VideoView video={video} onClose={onClose} />);
    fireEvent.click(button("Delete"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fakes.deleteVideoAudio).toHaveBeenCalledWith(video);
    expect(useTutorStore.getState().guides[video.id]).toBeUndefined();
  });
});

describe("infographic", () => {
  const infographic = guide({
    kind: "infographic",
    title: "Lava at a glance",
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"></svg>',
  });

  it("shows the drawing fit or at full size", () => {
    render(<InfographicView infographic={infographic} onClose={onClose} />);
    expect(
      screen.getByRole("img", { name: "Lava at a glance" }).getAttribute("src"),
    ).toMatch(/^data:image\/svg\+xml/);
    fireEvent.click(button("Show at full size"));
    expect(button("Fit to the panel")).toBeTruthy();
  });

  it("saves as an SVG file", async () => {
    render(<InfographicView infographic={infographic} onClose={onClose} />);
    fireEvent.click(button("Save as SVG"));
    await vi.waitFor(() => expect(fakes.saveBytes).toHaveBeenCalled());
    const [blob, name, extension, kind] = fakes.saveBytes.mock.calls[0];
    expect([name, extension, kind]).toEqual(["Lava at a glance", "svg", "SVG image"]);
    expect(await (blob as Blob).text()).toBe(infographic.body);
  });
});
