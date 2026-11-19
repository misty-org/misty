import { useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import {
  parseVideoProject,
  VIDEO_PROJECT_MIME,
  VideoEditor,
  VideoEditorOpening,
  type VideoProjectSource,
} from "@/features/files";
import { spacesApi } from "../../api/api";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { libraryFileById, useVideoEditorSpace } from "./useVideoEditorSpace";
import { useMediaAgent, VideoAgentPanel } from "@/features/agents";
import { forgetProjectStart, projectStart } from "./videoProjects";
import { acquireImageSession, releaseImageSession } from "./imageCollaboration";

/** A project's name without its file extension, as the editor's bar shows it. */
function projectName(item: SpaceLibraryItem): string {
  return item.display_name.replace(/\.mistyvideo$/i, "") || "Untitled video";
}

/**
 * A video project in Media, opened in the video editor and kept in Media as it changes: each
 * change replaces the project's file with a new version. Someone who can only view the Space
 * edits a copy of their own that isn't kept; they can still download an export.
 */
export function LibraryVideoProjectView(props: {
  spaceId: string;
  item: SpaceLibraryItem;
  canEdit: boolean;
  onClose: () => void;
  onReplaceItem: (item: SpaceLibraryItem) => void;
  onSaved: () => void;
}) {
  const { spaceId, item, canEdit } = props;
  // Each kept version names the next one it replaces.
  const current = useRef(item);
  const callbacks = useRef(props);
  callbacks.current = props;
  // One project per opening: a new version of the item doesn't reopen it.
  const itemId = item.id;
  // The project's live room (the same kind of room an image's live edit uses), or null when it
  // can't be reached: the project still opens and is kept, only without others' changes live.
  const [room, setRoom] = useState<Y.Doc | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    acquireImageSession(spaceId, itemId).then(
      (session) => live && setRoom(session.doc),
      () => live && setRoom(null),
    );
    return () => {
      live = false;
      releaseImageSession(spaceId, itemId);
    };
  }, [itemId, spaceId]);
  const project = useMemo<VideoProjectSource>(() => {
    const opened = current.current;
    const filename = opened.file.original_filename || `${projectName(opened)}.mistyvideo`;
    return {
      load: async () => {
        const blob = await spacesApi.libraryContent(spaceId, itemId);
        return parseVideoProject(await blob.text());
      },
      loadMedia: (mediaId) => libraryFileById(spaceId, mediaId),
      startWith: projectStart(itemId),
      keep: async (document) => {
        if (!canEdit) return;
        const blob = new Blob([JSON.stringify(document)], { type: VIDEO_PROJECT_MIME });
        const replace = () =>
          spacesApi.replaceLibraryItemContent(spaceId, current.current, blob, filename);
        // Someone else may have kept a newer version since; this change replaces that one.
        const result = await replace().catch(async () => {
          current.current = await spacesApi.libraryItem(spaceId, itemId);
          return replace();
        });
        forgetProjectStart(itemId);
        if (result.item) {
          current.current = result.item;
          callbacks.current.onReplaceItem(result.item);
        }
      },
      keepMedia: async (file) => {
        if (!canEdit) throw new Error("This Space's Media can't be added to.");
        const result = await spacesApi.uploadLibraryBlob(spaceId, file, file.name, "library");
        if (!result.item) throw new Error(`“${file.name}” could not be added to Media.`);
        return result.item.id;
      },
      room: room ?? undefined,
    };
  }, [canEdit, itemId, room, spaceId]);
  const space = useVideoEditorSpace(spaceId, canEdit, props.onSaved);
  // The Agent tab, where the person's agent can work on this project (its home Space is here).
  const agent = useMediaAgent(spaceId);
  const agentPanel = useMemo(
    () =>
      canEdit && agent ? (
        <VideoAgentPanel spaceId={spaceId} itemId={itemId} name={projectName(current.current)} />
      ) : undefined,
    [agent, canEdit, itemId, spaceId],
  );
  if (room === undefined)
    return <VideoEditorOpening name={projectName(item)} onClose={props.onClose} />;
  return (
    <VideoEditor
      name={projectName(item)}
      project={project}
      agentPanel={agentPanel}
      onClose={props.onClose}
      {...space}
    />
  );
}
