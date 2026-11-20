import type { NavigateFunction } from "react-router-dom";
import { spaceMadeKind } from "@misty/ui";
import { drawingsApi } from "../journal/drawings/api/api";
import { decksApi } from "../slides/api";
import { workbooksApi } from "../data/api";
import { notesApi } from "../journal/notes/api/api";
import { preloadSpaceSection } from "../overview/SpaceSectionView";
import { spaceChatPath } from "../chat/chatRoute";

export type SpaceCreateKind = "chat" | "note" | "deck" | "workbook" | "drawing" | "file";

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
    const { section, untitled } = spaceMadeKind("note");
    await preloadSpaceSection(section);
    const note = await notesApi.create(spaceId, untitled);
    onCreated();
    navigate(`${base}/${section}?note=${encodeURIComponent(note.id)}`);
  } else if (kind === "drawing") {
    const { section, untitled } = spaceMadeKind("drawing");
    await preloadSpaceSection(section);
    const drawing = await drawingsApi.create(spaceId, untitled);
    onCreated();
    navigate(`${base}/${section}/${encodeURIComponent(drawing.id)}`);
  } else if (kind === "deck" || kind === "workbook") {
    const made = spaceMadeKind(kind);
    await preloadSpaceSection(made.section);
    const api = kind === "deck" ? decksApi : workbooksApi;
    const item = await api.create(spaceId, made.untitled);
    onCreated();
    navigate(made.href(spaceId, item.id));
  } else if (kind === "chat") {
    await preloadSpaceSection("social");
    navigate(spaceChatPath(spaceId));
  } else {
    openFilePicker();
  }
}
