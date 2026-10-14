export interface ArchiveEntry {
  path: string;
  isDir: boolean;
  compressedSize: number;
  uncompressedSize: number;
}
export interface SavedSearchRule {
  field: string;
  operator: string;
  value: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  rules: SavedSearchRule[];
  updatedAtMs: number;
}
