import { SmartLibraryPanel, openFilesTabRevealing } from "@/features/files/workspace";
import { LibraryEntryHeader } from "../components/LibraryEntryHeader";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";

/** On-device files analyzed by Mika: AI tags, rule-based collections, and semantic search. */
export function SmartLibrarySection() {
  const { data } = useSpaceLibraryContext();
  if (data.collection !== "smart") return null;
  return (
    <SmartLibraryPanel
      embedded
      renderHeader={(controls) => <LibraryEntryHeader smartControls={controls} />}
      onOpenResult={(result) => void openFilesTabRevealing(result)}
    />
  );
}
