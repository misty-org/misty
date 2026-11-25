export const draggedFilesScope = "misty-files";

export interface DraggedFile {
  name: string;
  read(): Promise<File>;
}

let held: { token: string; files: DraggedFile[] } | null = null;
let sequence = 0;

export function holdDraggedFiles(files: DraggedFile[]): string {
  held = { token: `files-${++sequence}`, files };
  return held.token;
}

export function draggedFiles(token: string): DraggedFile[] {
  return held?.token === token ? held.files : [];
}

export async function readDraggedFiles(
  token: string,
): Promise<{ files: File[]; failed: string[] }> {
  const files: File[] = [];
  const failed: string[] = [];
  for (const file of draggedFiles(token)) {
    try {
      files.push(await file.read());
    } catch {
      failed.push(`Misty couldn't read ${file.name}.`);
    }
  }
  return { files, failed };
}
