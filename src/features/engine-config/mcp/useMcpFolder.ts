import { useState } from "react";
import { useLinkedFolders } from "../host";

/** The folder whose project config is read: the Space's chosen linked folder, or none. */
export function useMcpFolder(): [string[], string | null, (folder: string | null) => void] {
  const { folders, picked: chosen } = useLinkedFolders();
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const fallback = chosen && folders.includes(chosen) ? chosen : (folders[0] ?? null);
  const folder =
    picked === undefined ? fallback : picked && folders.includes(picked) ? picked : null;
  return [folders, folder, setPicked];
}
