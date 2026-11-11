import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSubtitlePrefs, type SubtitlesView } from "./subtitlesView";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
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
  mocks.streams.length = 0;
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(7);
});

describe("a subtitle session", () => {
  it("listens to all of this computer's sound, Misty's included, by default", async () => {
    const { running } = session();
    await running.start();
    expect(mocks.invoke).toHaveBeenCalledWith("voice_capture_start", {
      request: { mic: false, system: true, includeMisty: true },
    });
  });

  it("listens to the microphone, and only that, when the person chose it", async () => {
    const { running } = session({ ...defaultSubtitlePrefs, input: "mic" });
    await running.start();
    expect(mocks.invoke).toHaveBeenCalledWith("voice_capture_start", {
      request: { mic: true, system: false, includeMisty: false },
    });
  });

  it("is live once the relay is listening, with no wait for any page", async () => {
    const { running, views } = session();
    await running.start();
    expect(views[views.length - 1]).toMatchObject({ status: "live" });
    expect(mocks.streams).toHaveLength(1);
  });

  it("gives the stream only the context the person wrote", async () => {
    const context = { ...defaultSubtitlePrefs.context, text: "A lecture on ethics." };
    const { running } = session({ ...defaultSubtitlePrefs, context });
    await running.start();
    expect(mocks.streams[0].context).toEqual({ text: "A lecture on ethics." });
  });

  it("says why it stopped when the capture can't start", async () => {
    mocks.invoke.mockRejectedValue("Screen and audio recording is off for Misty.");
    const { running, ended } = session();
    await running.start();
    expect(ended).toEqual(["Screen and audio recording is off for Misty."]);
  });

  it("ends when its stream closes", async () => {
    const { running, ended } = session();
    await running.start();
    mocks.streams[0].events.onClosed?.();
    await vi.waitFor(() => expect(ended).toHaveLength(1));
  });
});
