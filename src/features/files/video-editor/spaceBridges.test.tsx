import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const picker = vi.hoisted(() => ({
  props: null as null | {
    onChoose: (ids: string[]) => void;
    onCancel: () => void;
    spaceId: string;
  },
}));
vi.mock("../picker/LibraryPickerSeam", () => ({
  LibraryPickerPanel: (props: NonNullable<typeof picker.props>) => {
    picker.props = props;
    return <div>Media picker for {props.spaceId}</div>;
  },
}));

import { getSpaceMedia } from "@opencut/media/space-media";
import { canTranscribe, transcriptionService } from "@opencut/services/transcription/service";
import { groupWordsIntoPhrases } from "@opencut/transcription/group-words";
import { useSpaceMediaBridge } from "./useSpaceMediaBridge";
import { useTranscriber } from "./useTranscriber";
import type { VideoEditorProps, VideoSpaceMedia } from "./videoEditorTypes";

afterEach(() => {
  cleanup();
  picker.props = null;
});

describe("recognized words become caption phrases", () => {
  const word = (text: string, start: number, end = start + 0.3) => ({ text, start, end });

  it("groups a few words at a time, with their real times", () => {
    const phrases = groupWordsIntoPhrases([
      word("we", 0, 0.25),
      word("went", 0.25, 0.5),
      word("to", 0.5, 0.75),
      word("the", 0.75, 1),
      word("beach", 1, 1.5),
    ]);
    expect(phrases).toEqual([
      { text: "we went to", start: 0, end: 0.75 },
      { text: "the beach", start: 0.75, end: 1.5 },
    ]);
  });

  it("starts a new caption after a sentence ends or a pause", () => {
    const phrases = groupWordsIntoPhrases([word("Hi.", 0), word("Look", 0.4), word("there", 2)]);
    expect(phrases.map((phrase) => phrase.text)).toEqual(["Hi.", "Look", "there"]);
  });
});

function Bridge({ media }: { media: VideoSpaceMedia | undefined }) {
  return <>{useSpaceMediaBridge(media)}</>;
}

describe("the editor reaches the Space it was opened from", () => {
  const media: VideoSpaceMedia = {
    spaceId: "s1",
    listAudio: vi.fn(async () => [{ id: "a1", name: "song.mp3" }]),
    load: vi.fn(async (id: string) => new File(["x"], `${id}.mp4`)),
  };

  it("opens Misty's Media picker and reads the files chosen", async () => {
    render(<Bridge media={media} />);
    const space = getSpaceMedia()!;
    let picked: File[] = [];
    await act(async () => {
      void space.pick().then((files) => (picked = files));
    });
    expect(screen.getByText("Media picker for s1")).toBeTruthy();
    await act(async () => picker.props!.onChoose(["v1", "v2"]));
    expect(picked.map((file) => file.name)).toEqual(["v1.mp4", "v2.mp4"]);
    expect(screen.queryByText(/Media picker/)).toBeNull();
  });

  it("answers no files when the picker is cancelled, and lets go when the editor closes", async () => {
    const view = render(<Bridge media={media} />);
    let picked: File[] | null = null;
    await act(async () => {
      void getSpaceMedia()!
        .pick()
        .then((files) => (picked = files));
    });
    await act(async () => picker.props!.onCancel());
    expect(picked).toEqual([]);
    expect(await getSpaceMedia()!.listAudio()).toEqual([{ id: "a1", name: "song.mp3" }]);
    view.unmount();
    expect(getSpaceMedia()).toBeNull();
  });
});

function Transcribing({ transcribe }: { transcribe: VideoEditorProps["transcribe"] }) {
  useTranscriber(transcribe);
  return null;
}

describe("captions use the computer's speech recognition", () => {
  it("transcribes through the given recognizer, in phrases, only while the editor is open", async () => {
    const transcribe = vi.fn(async () => [
      { text: "hello", start: 0, end: 0.4 },
      { text: "there.", start: 0.4, end: 0.8 },
    ]);
    const view = render(<Transcribing transcribe={transcribe} />);
    expect(canTranscribe()).toBe(true);
    const result = await transcriptionService.transcribe({
      audioBlob: new Blob(["wav"]),
      language: "fr",
    });
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), "fr");
    expect(result.segments).toEqual([
      {
        text: "hello there.",
        start: 0,
        end: 0.8,
        words: [
          { text: "hello", start: 0, end: 0.4 },
          { text: "there.", start: 0.4, end: 0.8 },
        ],
      },
    ]);
    view.unmount();
    expect(canTranscribe()).toBe(false);
  });

  it("offers none where the computer has no recognizer", () => {
    render(<Transcribing transcribe={undefined} />);
    expect(canTranscribe()).toBe(false);
  });
});
