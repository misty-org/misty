import type { Folder } from "lucide-react";
import { Camera, Download, FileText, Film, Headphones, Image, Mic2, Music } from "lucide-react";

/**
 * The standard Android media folders offered under Quick access.
 *
 * `targetNames` are the normalized names a per-folder grant can come back as —
 * the OS picker reports "Download" or "Downloads" depending on the device.
 */
export const androidSuggestedLocalFolders = [
  { label: "Documents", icon: FileText, initialDirectory: "Documents", targetNames: ["documents"] },
  {
    label: "Downloads",
    icon: Download,
    initialDirectory: "Download",
    targetNames: ["download", "downloads"],
  },
  { label: "Pictures", icon: Image, initialDirectory: "Pictures", targetNames: ["pictures"] },
  { label: "Camera", icon: Camera, initialDirectory: "DCIM", targetNames: ["dcim", "camera"] },
  { label: "Movies", icon: Film, initialDirectory: "Movies", targetNames: ["movies", "videos"] },
  { label: "Music", icon: Music, initialDirectory: "Music", targetNames: ["music"] },
  { label: "Recordings", icon: Mic2, initialDirectory: "Recordings", targetNames: ["recordings"] },
  { label: "Ringtones", icon: Music, initialDirectory: "Ringtones", targetNames: ["ringtones"] },
  {
    label: "Audiobooks",
    icon: Headphones,
    initialDirectory: "Audiobooks",
    targetNames: ["audiobooks"],
  },
  { label: "Podcasts", icon: Headphones, initialDirectory: "Podcasts", targetNames: ["podcasts"] },
] satisfies Array<{
  label: string;
  icon: typeof Folder;
  initialDirectory: string;
  targetNames: string[];
}>;

export function normalizeAndroidLocalName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}
