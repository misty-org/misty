import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type * as FilesModule from "@/features/files";
import type { VideoEditorProps } from "@/features/files";
import type { SpaceLibraryItem } from "../../api/dto/entities";

const { editor, api, room } = vi.hoisted(() => ({
  editor: { props: null as VideoEditorProps | null },
  api: {
    libraryContent: vi.fn(),
    libraryItem: vi.fn(),
    replaceLibraryItemContent: vi.fn(),
    uploadLibraryBlob: vi.fn(),
    libraryItems: vi.fn(async () => ({ items: [] })),
  },
  room: { acquire: vi.fn(), release: vi.fn() },
}));

vi.mock("@/features/files", async (importOriginal) => ({
  ...(await importOriginal<typeof FilesModule>()),
  VideoEditor: (props: VideoEditorProps) => {
    editor.props = props;
    return <div>Editing {props.name}</div>;
  },
  VideoEditorOpening: (props: { name: string }) => <div>Opening {props.name}</div>,
}));
vi.mock("../../api/api", () => ({ spacesApi: api }));
vi.mock("@/features/voice", () => ({
  recognizeAudioWords: vi.fn(),
  useSpeechSupport: () => null,
}));
vi.mock("@/features/agents", () => ({
  useMediaAgent: () => ({ agent: { id: "ag" }, account: "acct" }),
  VideoAgentPanel: (props: { itemId: string }) => <div>Agent for {props.itemId}</div>,
}));
vi.mock("./imageCollaboration", () => ({
  acquireImageSession: room.acquire,
  releaseImageSession: room.release,
}));

import { LibraryVideoProjectView } from "./LibraryVideoProjectView";
import { createVideoProject, forgetProjectStart, projectStart } from "./videoProjects";

const projectItem = (version: number) =>
  ({
    id: "p1",
    display_name: "Trip.mistyvideo",
    version,
    tags: [],
    file: { original_filename: "Trip.mistyvideo", intrinsic_metadata: {} },
  }) as unknown as SpaceLibraryItem;

afterEach(() => {
  cleanup();
  editor.props = null;
  vi.clearAllMocks();
});

async function openProject(canEdit = true, onReplaceItem = vi.fn()) {
  const doc = new Y.Doc();
  room.acquire.mockResolvedValue({ doc });
  render(
    <LibraryVideoProjectView
      spaceId="s1"
      item={projectItem(1)}
      canEdit={canEdit}
      onClose={vi.fn()}
      onReplaceItem={onReplaceItem}
      onSaved={vi.fn()}
    />,
  );
  await screen.findByText("Editing Trip");
  return { doc, project: editor.props!.project! };
}

describe("a video project in Media", () => {
  it("opens over its live room, showing the editor's shape until the room answers", async () => {
    let answer: (value: { doc: Y.Doc }) => void = () => undefined;
    room.acquire.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(
      <LibraryVideoProjectView
        spaceId="s1"
        item={projectItem(1)}
        canEdit
        onClose={vi.fn()}
        onReplaceItem={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("Opening Trip")).toBeTruthy();
    const doc = new Y.Doc();
    await act(async () => answer({ doc }));
    expect(screen.getByText("Editing Trip")).toBeTruthy();
    expect(editor.props!.project!.room).toBe(doc);
    cleanup();
    expect(room.release).toHaveBeenCalledWith("s1", "p1");
  });

  it("still opens, without others' changes live, when the room can't be reached", async () => {
    room.acquire.mockRejectedValue(new Error("offline"));
    render(
      <LibraryVideoProjectView
        spaceId="s1"
        item={projectItem(1)}
        canEdit
        onClose={vi.fn()}
        onReplaceItem={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await screen.findByText("Editing Trip");
    expect(editor.props!.project!.room).toBeUndefined();
  });

  it("reads the project from its file", async () => {
    api.libraryContent.mockResolvedValue(
      new Blob([JSON.stringify({ kind: "misty.video", version: 1, project: null, media: [] })]),
    );
    const { project } = await openProject();
    expect(await project.load()).toEqual({
      kind: "misty.video",
      version: 1,
      project: null,
      media: [],
    });
    expect(api.libraryContent).toHaveBeenCalledWith("s1", "p1");
  });

  it("keeps each change as a new version, replacing the newest one if someone kept since", async () => {
    const onReplaceItem = vi.fn();
    api.replaceLibraryItemContent
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce({ item: projectItem(3) })
      .mockResolvedValueOnce({ item: projectItem(4) });
    api.libraryItem.mockResolvedValue(projectItem(2));
    const { project } = await openProject(true, onReplaceItem);
    await project.keep({ kind: "misty.video", version: 1, project: null, media: [] });
    expect(api.replaceLibraryItemContent).toHaveBeenLastCalledWith(
      "s1",
      expect.objectContaining({ version: 2 }),
      expect.any(Blob),
      "Trip.mistyvideo",
    );
    expect(onReplaceItem).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
    await project.keep({ kind: "misty.video", version: 1, project: null, media: [] });
    expect(api.replaceLibraryItemContent).toHaveBeenLastCalledWith(
      "s1",
      expect.objectContaining({ version: 3 }),
      expect.any(Blob),
      "Trip.mistyvideo",
    );
  });

  it("adds media from the computer to Media, and keeps nothing for those who can only view", async () => {
    api.uploadLibraryBlob.mockResolvedValue({ item: { id: "m1" } });
    const { project } = await openProject();
    expect(await project.keepMedia(new File(["x"], "clip.mov"))).toBe("m1");
    cleanup();
    const viewer = await openProject(false);
    await viewer.project.keep({ kind: "misty.video", version: 1, project: null, media: [] });
    expect(api.replaceLibraryItemContent).not.toHaveBeenCalled();
    await expect(viewer.project.keepMedia(new File(["x"], "c.mov"))).rejects.toThrow();
  });
});

describe("making a video in Media", () => {
  it("adds an empty project file, made from the selection when there is one", async () => {
    api.uploadLibraryBlob.mockResolvedValue({ item: { id: "new" } });
    const item = await createVideoProject("s1", "Untitled video", ["v1", "v2"]);
    expect(item.id).toBe("new");
    const [space, blob, name, purpose] = api.uploadLibraryBlob.mock.calls[0];
    expect([space, name, purpose]).toEqual(["s1", "Untitled video.mistyvideo", "library"]);
    expect(JSON.parse(await (blob as Blob).text())).toEqual({
      kind: "misty.video",
      version: 1,
      project: null,
      media: [],
    });
    expect(projectStart("new")).toEqual(["v1", "v2"]);
    expect(projectStart("new")).toEqual(["v1", "v2"]);
    forgetProjectStart("new");
    expect(projectStart("new")).toEqual([]);
  });

  it("passes the selection to the editor the first time the project opens", async () => {
    api.uploadLibraryBlob.mockResolvedValue({ item: { id: "p1" } });
    await createVideoProject("s1", "Untitled video", ["v1"]);
    const { project } = await openProject();
    expect(project.startWith).toEqual(["v1"]);
    api.replaceLibraryItemContent.mockResolvedValue({ item: projectItem(2) });
    await project.keep({ kind: "misty.video", version: 1, project: null, media: [] });
    await waitFor(() => expect(projectStart("p1")).toEqual([]));
  });
});

describe("the Agent tab in a project", () => {
  it("is given to the editor for those who can edit, and not for viewers", async () => {
    await openProject(true);
    render(<>{editor.props!.agentPanel}</>);
    expect(screen.getByText("Agent for p1")).toBeTruthy();
    cleanup();
    await openProject(false);
    expect(editor.props!.agentPanel).toBeUndefined();
  });
});
