import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as FilesModule from "@/features/files";
import type { VideoEditorProps } from "@/features/files";
import type { SpaceLibraryItem } from "../../api/dto/entities";

const { editor, api, speech } = vi.hoisted(() => ({
  editor: { props: null as VideoEditorProps | null },
  api: {
    libraryContent: vi.fn(async () => new Blob(["frames"], { type: "video/mp4" })),
    uploadLibraryBlob: vi.fn(async () => ({})),
    libraryItems: vi.fn(async () => ({
      items: [{ id: "a1", display_name: "Song" }],
    })),
    libraryItem: vi.fn(async (_space: string, id: string) => ({
      id,
      display_name: "Song",
      file: { original_filename: "song.mp3", intrinsic_metadata: {} },
    })),
  },
  speech: { recognition: false },
}));
vi.mock("@/features/voice", () => ({
  recognizeAudioWords: vi.fn(),
  useSpeechSupport: () => ({ recognition: speech.recognition, voices: [] }),
}));

vi.mock("@/features/files", async (importOriginal) => ({
  ...(await importOriginal<typeof FilesModule>()),
  // jsdom has no WebCodecs; the editor is offered as on a computer that has them.
  canEditVideo: () => true,
  VideoEditor: (props: VideoEditorProps) => {
    editor.props = props;
    return <div>Editing {props.name}</div>;
  },
}));
vi.mock("../../api/api", () => ({ spacesApi: api }));
// The viewer's other paths, so the test reaches the branch that picks the editor.
vi.mock("./LibraryPhotoEditorView", () => ({
  LibraryPhotoEditorView: () => <div>Photo editor</div>,
}));
vi.mock("./useLibraryEditVersions", () => ({
  useLibraryEditVersions: () => ({
    editVersions: [],
    setEditVersions: vi.fn(),
    setEditDraft: vi.fn(),
  }),
}));
vi.mock("./useLibraryItemContent", () => ({
  useLibraryItemContent: () => ({ contentUrl: "", contentLoading: false, contentError: "" }),
  usePrefetchLibraryNeighbors: vi.fn(),
}));
vi.mock("./useLibraryEditActions", () => ({
  useLibraryEditActions: () => ({ setEditError: vi.fn() }),
}));
vi.mock("./useLibraryViewerPlayback", () => ({ useLibraryViewerPlayback: () => ({}) }));
vi.mock("./useLibraryViewerKeyboard", () => ({ useLibraryViewerKeyboard: vi.fn() }));

import { LibraryVideoEditorView } from "./LibraryVideoEditorView";
import { SpaceLibraryViewer } from "../SpaceLibraryViewer";

const video = {
  id: "v1",
  display_name: "Trip",
  version: 1,
  tags: [],
  file: {
    original_filename: "trip.mp4",
    intrinsic_metadata: { server_detected_mime_type: "video/mp4" },
  },
} as unknown as SpaceLibraryItem;

afterEach(() => {
  cleanup();
  editor.props = null;
  vi.clearAllMocks();
});

describe("a video in Media opens in the video editor", () => {
  it("starts from the video's own file", async () => {
    render(
      <LibraryVideoEditorView
        spaceId="s1"
        item={video}
        mimeType="video/mp4"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("Editing Trip")).toBeTruthy();
    const file = await editor.props!.loadSource!();
    expect(api.libraryContent).toHaveBeenCalledWith("s1", "v1");
    expect(file.name).toBe("trip.mp4");
    expect(file.type).toBe("video/mp4");
  });

  it("saves an export into Media beside it", async () => {
    const onSaved = vi.fn();
    render(
      <LibraryVideoEditorView
        spaceId="s1"
        item={video}
        mimeType="video/mp4"
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    expect(editor.props!.destination?.label).toBe("Save to Media");
    const blob = new Blob(["mp4"], { type: "video/mp4" });
    await editor.props!.destination!.save({ blob, filename: "Trip.mp4" });
    expect(api.uploadLibraryBlob).toHaveBeenCalledWith("s1", blob, "Trip.mp4", "library");
    expect(onSaved).toHaveBeenCalled();
  });

  it("reaches the Space's audio and files for the editor's Media and Sounds tabs", async () => {
    render(
      <LibraryVideoEditorView
        spaceId="s1"
        item={video}
        mimeType="video/mp4"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const media = editor.props!.spaceMedia!;
    expect(media.spaceId).toBe("s1");
    expect(await media.listAudio()).toEqual([{ id: "a1", name: "Song" }]);
    expect(api.libraryItems).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ media_type: "audio" }),
    );
    const file = await media.load("a1");
    expect(api.libraryItem).toHaveBeenCalledWith("s1", "a1");
    expect(file.name).toBe("song.mp3");
  });

  it.each([
    [true, true],
    [false, false],
  ])("offers captions only where the computer recognizes speech (%s)", (recognition, offered) => {
    speech.recognition = recognition;
    render(
      <LibraryVideoEditorView
        spaceId="s1"
        item={video}
        mimeType="video/mp4"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(Boolean(editor.props!.transcribe)).toBe(offered);
    speech.recognition = false;
  });

  it.each([
    [true, "Editing Trip"],
    [false, null],
  ])("from the Media viewer when it can be edited (%s)", (canEdit, shown) => {
    render(
      <SpaceLibraryViewer
        spaceId="s1"
        item={video}
        items={[video]}
        canEdit={canEdit}
        canCopy
        returnFocusRef={{ current: null }}
        onCopyEdit={vi.fn()}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onUpdate={vi.fn()}
        onReplaceItem={vi.fn()}
        onRenditionReady={vi.fn()}
        onTrash={vi.fn()}
      />,
    );
    if (shown) expect(screen.getByText(shown)).toBeTruthy();
    else expect(screen.queryByText(/^Editing/)).toBeNull();
  });
});
