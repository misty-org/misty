import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { IconButton, notify, OverflowFadeText, SetupState, Text, TopBar } from "@misty/ui";
import { EditorProvider } from "@opencut/components/providers/editor-provider";
import { EditorLayout } from "@opencut/components/editor/editor-layout";
import { ExportButton } from "@opencut/components/editor/export-button";
import { useEditor } from "@opencut/editor/use-editor";
import {
  claimVideoProject,
  placeSourceOnTimeline,
  releaseVideoProject,
  startVideoProject,
} from "./videoProject";
import { openVideoProject, showRemoteProject } from "./projectDocument";
import type { VideoProjectDocument } from "./projectDocumentTypes";
import {
  newerProject,
  projectUpdatedAt,
  readRoomProject,
  watchRoomProject,
  writeRoomProject,
} from "./projectRoom";
import { createProjectKeeper, type ProjectKeeper } from "./projectKeeper";
import { useSpaceMediaBridge } from "./useSpaceMediaBridge";
import { setAgentPanel } from "@opencut/media/agent-panel";
import { useTranscriber } from "./useTranscriber";
import { useEditorMarks } from "./editorMarks";
import { useEditorMusic } from "./editorMusic";
import type { VideoEditorProps, VideoProjectSource } from "./videoEditorTypes";

/** The project a session edits, and how it is kept. */
interface Opened {
  projectId: string;
  /** Keeps a project from a Space as it changes; null for a video opened from a file. */
  keeper: ProjectKeeper | null;
  /** Its media assets' Media items, for a project from a Space. */
  itemIds: Map<string, string>;
  /** A new project with media to lay on its timeline first. */
  startWith: string[];
  /** When the project this editor shows last changed: older documents in the room are passed by. */
  latest: { at: number };
}

async function openSession(
  props: VideoEditorProps,
  onKeepError: (error: Error) => void,
): Promise<Opened> {
  const source = props.project;
  if (!source) {
    return {
      projectId: await startVideoProject(props.name),
      keeper: null,
      itemIds: new Map(),
      startWith: [],
      latest: { at: 0 },
    };
  }
  const room = source.room;
  const loaded = await source.load();
  // The room has the latest change when someone is editing it right now.
  const document = newerProject(loaded, room ? readRoomProject(room) : null);
  const itemIds = new Map(document.media.map((media) => [media.assetId, media.itemId]));
  const projectId = await openVideoProject(props.name, document, source.loadMedia);
  const latest = { at: projectUpdatedAt(document) };
  // What is kept in the Space goes to the room too, for the editors already open.
  const keeping = {
    ...source,
    keep: async (kept: VideoProjectDocument) => {
      await source.keep(kept);
      latest.at = Math.max(latest.at, projectUpdatedAt(kept));
      if (room) writeRoomProject(room, kept);
    },
  };
  return {
    projectId,
    keeper: createProjectKeeper(projectId, keeping, itemIds, onKeepError),
    itemIds,
    startWith: document.project === null ? (source.startWith ?? []) : [],
    latest,
  };
}

/**
 * One editing session, in OpenCut's layout under Misty's bar. A video opened from a file is a
 * new project of the editor's own with the file on its timeline; what is kept of it is what is
 * exported. A video project from a Space opens as kept there and is kept there as it changes.
 * Either way the editor's own copy is let go when it closes.
 */
export default function VideoEditorSession(props: VideoEditorProps) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [failure, setFailure] = useState("");
  const { name } = props;
  const picker = useSpaceMediaBridge(props.spaceMedia);
  useTranscriber(props.transcribe);
  useEditorMusic();
  useEditorMarks();
  // The Agent tab shows what Misty gives it, while the editor is open.
  const { agentPanel } = props;
  useEffect(() => {
    setAgentPanel(agentPanel ?? null);
    return () => setAgentPanel(null);
  }, [agentPanel]);
  // The session opens once, from what it was first given.
  const first = useRef(props);
  useEffect(() => {
    let live = true;
    let session: Opened | null = null;
    const reportKeepError = (error: Error) => notify({ message: error.message, tone: "error" });
    openSession(first.current, reportKeepError).then(
      (result) => {
        claimVideoProject(result.projectId);
        session = result;
        if (live) setOpened(result);
        else void releaseVideoProject(result.projectId);
      },
      (reason: unknown) =>
        live &&
        setFailure(reason instanceof Error ? reason.message : "The video could not be opened."),
    );
    return () => {
      live = false;
      const closing = session;
      if (!closing) return;
      // What hasn't been kept yet is kept before the editor's own copy goes.
      void (closing.keeper?.flush() ?? Promise.resolve()).finally(() =>
        releaseVideoProject(closing.projectId),
      );
    };
  }, []);
  if (failure)
    return (
      <div className="grid size-full place-items-center">
        <Text as="p" size="control" tone="danger">
          {failure}
        </Text>
      </div>
    );
  // Its project is still being fetched and opened: the editor is still getting ready.
  if (!opened) return <SetupState tool="video editor" />;
  const { projectId } = opened;
  return (
    <div className="flex size-full min-h-0 flex-col">
      <EditorProvider projectId={projectId}>
        <TopBar
          aria-label="Video"
          start={<OverflowFadeText className="min-w-0">{name}</OverflowFadeText>}
        >
          <ExportButton destination={props.destination} />
          {/* Escape belongs to the editor (it cancels a drag or a selection), so Close has no key. */}
          <IconButton label="Close" onClick={props.onClose}>
            <X />
          </IconButton>
        </TopBar>
        <div className="min-h-0 flex-1 pb-3">
          <EditorLayout />
        </div>
        {props.loadSource && <SourceImport projectId={projectId} loadSource={props.loadSource} />}
        {opened.keeper && props.project && (
          <ProjectKeeping
            opened={opened}
            keeper={opened.keeper}
            loadMedia={props.project.loadMedia}
            room={props.project.room}
          />
        )}
      </EditorProvider>
      {picker}
    </div>
  );
}

/** Puts the opened file on the timeline once, after the project has loaded. */
function SourceImport(props: { projectId: string; loadSource: () => Promise<File> }) {
  const active = useEditor((editor) => editor.project.getActiveOrNull());
  const imported = useRef(false);
  const { projectId, loadSource } = props;
  useEffect(() => {
    if (!active || imported.current) return;
    imported.current = true;
    loadSource()
      .then((file) => placeSourceOnTimeline(projectId, file))
      .catch((reason: unknown) =>
        notify({
          message: reason instanceof Error ? reason.message : "The video could not be opened.",
          tone: "error",
        }),
      );
  }, [active, loadSource, projectId]);
  return null;
}

/**
 * Keeps a project from a Space as it changes. A new one first gets the media it was made from,
 * in order on its timeline.
 */
function ProjectKeeping(props: {
  opened: Opened;
  keeper: ProjectKeeper;
  loadMedia: (itemId: string) => Promise<File>;
  room?: VideoProjectSource["room"];
}) {
  const editor = useEditor();
  const active = useEditor((current) => current.project.getActiveOrNull());
  const started = useRef(false);
  const { opened, keeper, loadMedia, room } = props;
  useEffect(() => editor.save.onSaved(() => keeper.schedule()), [editor, keeper]);
  // A change someone else made (a person or an agent) shows here as it lands in the room.
  useEffect(() => {
    if (!room) return;
    return watchRoomProject(room, (document) => {
      const at = projectUpdatedAt(document);
      if (at <= opened.latest.at) return;
      opened.latest.at = at;
      for (const media of document.media) opened.itemIds.set(media.assetId, media.itemId);
      showRemoteProject(document, loadMedia).catch((reason: unknown) =>
        notify({
          message:
            reason instanceof Error ? reason.message : "A change to the video could not be shown.",
          tone: "error",
        }),
      );
    });
  }, [loadMedia, opened, room]);
  useEffect(() => {
    if (!active || started.current || opened.startWith.length === 0) return;
    started.current = true;
    void (async () => {
      try {
        for (const itemId of opened.startWith) {
          const assetId = await placeSourceOnTimeline(opened.projectId, await loadMedia(itemId));
          opened.itemIds.set(assetId, itemId);
        }
      } catch (reason) {
        notify({
          message: reason instanceof Error ? reason.message : "The media could not be added.",
          tone: "error",
        });
      }
      keeper.schedule();
    })();
  }, [active, keeper, loadMedia, opened]);
  return null;
}
