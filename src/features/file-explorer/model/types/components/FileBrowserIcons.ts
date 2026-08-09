export type MaterialIconTheme = {
  iconDefinitions: Record<string, { iconPath?: string }>;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  folder: string;
  file: string;
};
