import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DWELL_MS, RecallRecorder, type ActivePage, type RecorderDeps } from "./recorder";

const article = {
  blocks: [
    { type: "heading", text: "Bike lanes" },
    { type: "paragraph", text: "The council voted. Card 4242 4242 4242 4242." },
  ],
};
const page = (url: string, extra: Partial<ActivePage> = {}): ActivePage => ({
  runtimeId: "tab-1",
  url,
  title: "Bike lanes",
  private: false,
  ...extra,
});

function setup(overrides: Partial<RecorderDeps> = {}) {
  const record = vi.fn(async (_event: unknown) => ({}));
  const readArticle = vi.fn(async () => article);
  const onFull = vi.fn();
  const deps: RecorderDeps = {
    privacy: () => ({ enabled: true, pausedUntil: 0, excludedSites: [] }),
    readArticle,
    record,
    onFull,
    attentive: () => true,
    ...overrides,
  };
  return { recorder: new RecallRecorder(deps), record, readArticle, onFull };
}

describe("RecallRecorder", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("remembers a page after it stays in front, without secrets", async () => {
    const { recorder, record } = setup();
    recorder.observe(page("https://news.example/bikes#top"));
    await vi.advanceTimersByTimeAsync(DWELL_MS - 1);
    expect(record).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(record).toHaveBeenCalledTimes(1);
    const event = record.mock.calls[0]![0] as { url: string; body: string; simhash: string };
    expect(event.url).toBe("https://news.example/bikes");
    expect(event.body).toBe("Bike lanes\nThe council voted. Card [number].");
    expect(event.simhash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("never reads private, sensitive or briefly seen pages", async () => {
    const { recorder, readArticle } = setup();
    recorder.observe(page("https://news.example/a", { private: true }));
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    recorder.observe(page("https://www.chase.com/"));
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    recorder.observe(page("https://news.example/b"));
    await vi.advanceTimersByTimeAsync(DWELL_MS / 2);
    recorder.observe(null);
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    expect(readArticle).not.toHaveBeenCalled();
  });

  it("skips a page Memory was paused on, or when Misty is in the background", async () => {
    let attentive = false;
    const { recorder, record } = setup({ attentive: () => attentive });
    recorder.observe(page("https://news.example/a"));
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    expect(record).not.toHaveBeenCalled();
    attentive = true;
    const paused = setup({
      privacy: () => ({ enabled: true, pausedUntil: Number.MAX_SAFE_INTEGER, excludedSites: [] }),
    });
    paused.recorder.observe(page("https://news.example/a"));
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    expect(paused.record).not.toHaveBeenCalled();
  });

  it("reads one address at most every half hour", async () => {
    const { recorder, record } = setup();
    recorder.observe(page("https://news.example/a"));
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    recorder.observe(page("https://news.example/b"));
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    recorder.observe(page("https://news.example/a"));
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("stops for a while and says so when Memory is full", async () => {
    const full = Object.assign(new Error("Memory is catching up."), { status: 429 });
    const failing = vi.fn(async () => Promise.reject(full));
    const { recorder, onFull } = setup({ record: failing });
    recorder.observe(page("https://news.example/a"));
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    expect(onFull).toHaveBeenCalledWith("Memory is catching up.");
    recorder.observe(page("https://news.example/b"));
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    // Only the first page was tried; the next waits out the backoff.
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
