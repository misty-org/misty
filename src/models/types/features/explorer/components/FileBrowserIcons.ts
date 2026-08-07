import { File, Folder } from "lucide-react";
import materialIconTheme from "material-icon-theme/dist/material-icons.json";
import type { FileEntry } from "@/models/interfaces/services/misty-api";
import { fileBrowserStyles } from "@/features/explorer/components/FileBrowserStyles";

export type MaterialIconTheme = {
  iconDefinitions: Record<string, { iconPath?: string }>;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  folder: string;
  file: string;
};
