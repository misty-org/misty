import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSubtitlePrefs, type SubtitlesView } from "./subtitlesView";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  readPage: vi.fn(),
  currentPage: vi.fn(),
  streams: [] as {
    context: unknown;
    finish: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    events: { onClosed?(): void };
  }[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("../api", () => ({ voiceDeviceId: vi.fn(async () => "device") }));
vi.mock("../capture/useCaptureStore", () => ({ decodePcm: vi.fn() }));
vi.mock("./savedSubtitles", () => ({ saveSubtitleSession: vi.fn() }));
vi.mock("./subtitlePage", () => ({
  currentPage: mocks.currentPage,
  readPage: mocks.readPage,
  pageKey: (page: { url: string }) => page.url,
}));
vi.mock("../liveTranscriber", () => ({
  LiveTranscriber: class {
    transcript = { latest: () => [] };
    finish = vi.fn(async () => "");
    close = vi.fn();
    push = vi.fn();
    private stream: (typeof mocks.streams)[number];
    constructor(events: { onClosed?(): void }) {
      this.stream = { context: undefined, finish: this.finish, close: this.close, events };
      mocks.streams.push(this.stream);
    }
    async connect(_session: unknown, start: { context: unknown }) {
      this.stream.context = start.context;
    }
  },
}));

import { SubtitleSession } from "./subtitleSession";

const context = (topic: string) => ({ domain: "", topic, terms: [], translationTerms: [] });
const page = (url: string) => ({ runtimeId: "tab", title: url, url });

function session(prefs = defaultSubtitlePrefs) {
  const views: Partial<SubtitlesView>[] = [];
  const ended: (string | undefined)[] = [];
  const running = new SubtitleSession({
    prefs: () => prefs,
    draw: (next) => views.push(next),
    ended: (notice) => ended.push(notice),
  });
  return { running, views, ended };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.streams.length = 0;
  mocks.invoke.mockReset();
  mocks.readPage.mockReset();
  mocks.currentPage.mockReset();
  mocks.invoke.mockResolvedValue(7);
});

afterEach(() => vi.useRealTimers());

describe("a subtitle session", () => {
  it("only ever asks for Misty's own tabs", async () => {
    mocks.currentPage.mockReturnValue(undefined);
    const { running } = session();
    await running.start();
    expect(mocks.invoke).toHaveBeenCalledWith("voice_capture_start", {
      request: { mic: false, system: false, mistyOnly: true },
    });
  });

  it("gives the first stream what the model made of the page", async () => {
    mocks.currentPage.mockReturnValue(page("https://a.test/"));
    mocks.readPage.mockResolvedValue(context("Topic A"));
    const { running, views } = session();
    await running.start();
    expect(mocks.streams[0].context).toEqual({ text: "Topic A" });
    expect(views[views.length - 1]).toMatchObject({ status: "live", pageTopic: "Topic A" });
  });

  it("waits for a tab to play, and can be stopped while it waits", async () => {
    mocks.currentPage.mockReturnValue(undefined);
    mocks.invoke.mockRejectedValueOnce("misty_tabs_silent").mockResolvedValue(7);
    const { running, views } = session();
    const started = running.start();
    await vi.advanceTimersByTimeAsync(1100);
    await started;
    expect(views[0]).toMatchObject({ status: "live" });
    expect(views[0].notice).toContain("Play something");
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "voice_capture_start")).toHaveLength(2);
  });

  it("gives up when no tab plays for as long as auto-stop waits", async () => {
    mocks.currentPage.mockReturnValue(undefined);
    mocks.invoke.mockRejectedValue("misty_tabs_silent");
    const { running, ended } = session({ ...defaultSubtitlePrefs, silenceSeconds: 10 });
    const started = running.start();
    await vi.advanceTimersByTimeAsync(12_000);
    await started;
    expect(ended).toEqual(["Stopped after 10 seconds of silence."]);
  });

  it("says when another failure stops it, instead of waiting", async () => {
    mocks.currentPage.mockReturnValue(undefined);
    mocks.invoke.mockRejectedValue("Screen and audio recording is off for Misty.");
    const { running, ended } = session();
    await running.start();
    expect(ended).toEqual(["Screen and audio recording is off for Misty."]);
  });

  it("swaps streams once a new page settles, and calls the model once per page", async () => {
    mocks.currentPage.mockReturnValue(page("https://a.test/"));
    mocks.readPage.mockImplementation(async ({ url }: { url: string }) => context(url));
    const { running, views } = session();
    await running.start();
    expect(mocks.streams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(16_000);
    mocks.currentPage.mockReturnValue(page("https://b.test/"));
    await vi.advanceTimersByTimeAsync(3000);
    // Seen once: it could still be a redirect.
    expect(mocks.streams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.streams).toHaveLength(2);
    expect(mocks.streams[1].context).toEqual({ text: "https://b.test/" });
    expect(mocks.streams[0].finish).toHaveBeenCalled();
    expect(views[views.length - 1]).toMatchObject({ pageTopic: "https://b.test/" });
    await vi.advanceTimersByTimeAsync(16_000);
    mocks.currentPage.mockReturnValue(page("https://a.test/"));
    await vi.advanceTimersByTimeAsync(6000);
    expect(mocks.streams).toHaveLength(3);
    expect(mocks.readPage).toHaveBeenCalledTimes(2);
  });

  it("keeps the stream when something other than a web page comes in front", async () => {
    mocks.currentPage.mockReturnValue(page("https://a.test/"));
    mocks.readPage.mockResolvedValue(context("Topic A"));
    const { running } = session();
    await running.start();
    mocks.currentPage.mockReturnValue(undefined);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.streams).toHaveLength(1);
  });

  it("isn't ended by an old stream closing", async () => {
    mocks.currentPage.mockReturnValue(page("https://a.test/"));
    mocks.readPage.mockImplementation(async ({ url }: { url: string }) => context(url));
    const { running, ended } = session();
    await running.start();
    await vi.advanceTimersByTimeAsync(16_000);
    mocks.currentPage.mockReturnValue(page("https://b.test/"));
    await vi.advanceTimersByTimeAsync(6000);
    mocks.streams[0].events.onClosed?.();
    expect(ended).toEqual([]);
    mocks.streams[1].events.onClosed?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(ended).toHaveLength(1);
  });

  it("still starts when the model can't answer, and says so", async () => {
    mocks.currentPage.mockReturnValue(page("https://a.test/"));
    mocks.readPage.mockRejectedValue(new Error("No model."));
    const { running, views } = session();
    await running.start();
    expect(views.some((view) => view.notice?.includes("couldn't read this page"))).toBe(true);
    expect(views[views.length - 1]).toMatchObject({ status: "live" });
  });

  it("doesn't wait long for a slow model, and uses its answer when it comes", async () => {
    mocks.currentPage.mockReturnValue(page("https://a.test/"));
    let answer!: (value: ReturnType<typeof context>) => void;
    mocks.readPage.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { running } = session();
    const started = running.start();
    await vi.advanceTimersByTimeAsync(6100);
    await started;
    expect(mocks.streams[0].context).toEqual({});
    answer(context("Late topic"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.streams).toHaveLength(2);
    expect(mocks.streams[1].context).toEqual({ text: "Late topic" });
  });
});
