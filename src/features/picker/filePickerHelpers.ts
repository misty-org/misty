import { readLocalFileFromPath } from "@/api/local-files";

export function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "file";
}

export async function readFileFromPath(path: string): Promise<File> {
  return readLocalFileFromPath(path, fileNameFromPath(path));
}

export async function readFilesFromPaths(paths: string[]): Promise<File[]> {
  return Promise.all(paths.map((path) => readFileFromPath(path)));
}
