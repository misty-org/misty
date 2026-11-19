import { spaceMadeKind } from "@/shared/ui";
import { preloadSpaceSection } from "../overview/SpaceSectionView";

/** The made kinds a file can become, and the files each takes. */
export const importableKinds = {
  note: { label: "Import doc", accept: ".md,.markdown,.txt,.docx" },
  drawing: { label: "Import Excalidraw file", accept: ".excalidraw,.json" },
  workbook: { label: "Import spreadsheet", accept: ".csv,.tsv,.xlsx" },
} as const;

export type ImportableKind = keyof typeof importableKinds;

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, "").trim();

/**
 * Makes a new doc, whiteboard or workbook in the Space from a file: a Markdown or Word file, an
 * Excalidraw file, or a CSV, TSV or Excel sheet. Its content is written into the item's live
 * room at once. Returns where the new item opens.
 */
export async function importSpaceItem(
  spaceId: string,
  kind: ImportableKind,
  file: File,
): Promise<string> {
  const made = spaceMadeKind(kind);
  await preloadSpaceSection(made.section);
  if (kind === "note") {
    const { importDocFile } = await import("../journal/notes/import/noteImport");
    const note = await importDocFile(spaceId, file);
    return made.href(spaceId, note.id);
  }
  if (kind === "drawing") {
    const { importExcalidrawFile } = await import("../journal/drawings/excalidrawFile");
    const drawing = await importExcalidrawFile(spaceId, file);
    return made.href(spaceId, drawing.id);
  }
  const [{ workbooksApi }, { withToolDoc }, { importWorkbookFile }] = await Promise.all([
    import("../data/api"),
    import("../collab/toolSession"),
    import("../data/import"),
  ]);
  const workbook = await workbooksApi.create(spaceId, baseName(file) || made.untitled);
  try {
    await withToolDoc("workbook", spaceId, workbook.id, (doc) => importWorkbookFile(doc, file));
  } catch (error) {
    // A file that couldn't be read leaves no empty workbook behind.
    await workbooksApi.remove(spaceId, workbook.id).catch(() => undefined);
    throw error;
  }
  return made.href(spaceId, workbook.id);
}
