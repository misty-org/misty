import type { DirectoryListing } from "@/native/ipc";
import * as H from "./index";

export function placeholderListing(path: string): DirectoryListing {
  return {
    path: H.normalizedPath(path),
    parentPath: null,
    location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
    entries: [],
    totalCount: 0,
    hiddenCount: 0,
  };
}
