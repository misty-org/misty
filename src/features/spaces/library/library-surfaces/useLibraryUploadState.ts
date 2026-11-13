import { useSpaceLibraryContext } from "../SpaceLibraryContext";

const IN_FLIGHT_STAGES = ["ready", "failed"];

/** The upload props every Library surface needs, derived in one place. */
export function useLibraryUploadState() {
  const { data } = useSpaceLibraryContext();
  const uploadAvailable = data.canUploadLibrary;
  const searching = Boolean(data.searchQuery || data.mediaType);
  // A Library with no files offers Upload in its empty state, so the top bar leaves it out
  // and the page keeps one primary button.
  const emptyLibrary =
    data.collection !== "deleted" &&
    !data.loading &&
    !searching &&
    (data.displayItems ?? []).length === 0;
  return {
    uploadAvailable,
    inHeader: uploadAvailable && !emptyLibrary,
    uploading: data.uploadJobs.some((job) => !IN_FLIGHT_STAGES.includes(job.stage)),
    uploadDisabled: (data.usage?.remaining_bytes ?? 1) <= 0,
    onUpload: () => data.setFilePickerOpen(true),
  };
}
