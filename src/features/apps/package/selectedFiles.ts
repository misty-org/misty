const selectedFiles = new Map<string, File>();

export function registerSelectedFile(file: File): string {
  const path = `https://misty-sdk.local/__selected-files/${crypto.randomUUID()}/${encodeURIComponent(file.name)}`;
  selectedFiles.set(path, file);
  return path;
}

/** Only files the person chose in this App's browser picker can be read. */
export function takeSelectedFile(path: string): File | undefined {
  const file = selectedFiles.get(path);
  selectedFiles.delete(path);
  return file;
}
