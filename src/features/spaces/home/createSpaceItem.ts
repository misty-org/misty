import type { NavigateFunction } from "react-router-dom";
import { drawingsApi } from "@/api/drawings/api";
import { notesApi } from "@/api/notes/api";
import { preloadSpaceSection } from "../SpaceSectionView";
import { spaceChatPath } from "../chat/chatRoute";

export type SpaceCreateKind = "chat" | "note" | "drawing" | "file" | "code";

/** Runs the same create action from the Home gallery and the Space bar. */
export async function createSpaceItem(
  spaceId: string,
  kind: SpaceCreateKind,
  navigate: NavigateFunction,
  openFilePicker: () => void,
  onCreated: () => void = () => {},
) {
  const base = `/spaces/${encodeURIComponent(spaceId)}`;
  if (kind === "note") {
    await preloadSpaceSection("notes");
    const note = await notesApi.create(spaceId, "Untitled note");
    onCreated();
    navigate(`${base}/notes?note=${encodeURIComponent(note.id)}`);
  } else if (kind === "drawing") {
    await preloadSpaceSection("drawings");
    const drawing = await drawingsApi.create(spaceId, "Untitled drawing");
    onCreated();
    navigate(`${base}/drawings/${encodeURIComponent(drawing.id)}`);
  } else if (kind === "chat") {
    await preloadSpaceSection("social");
    navigate(spaceChatPath(spaceId));
  } else if (kind === "file") {
    openFilePicker();
  } else {
    await preloadSpaceSection("code");
    navigate(`${base}/code`);
  }
}
