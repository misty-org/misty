export interface ArchiveEntry {
  path: string;
  isDir: boolean;
  compressedSize: number;
  uncompressedSize: number;
}
