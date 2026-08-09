import { useSpaceLibraryContext } from "../SpaceLibraryContext";

const IN_FLIGHT_STAGES = ["ready", "failed"];

/** The four upload props every Library empty state needs, derived in one place. */
export function useLibraryUploadState() {
  const { data } = useSpaceLibraryContext();
  return {
    uploadAvailable: data.canUploadLibrary,
    uploading: data.uploadJobs.some((job) => !IN_FLIGHT_STAGES.includes(job.stage)),
    uploadDisabled: (data.usage?.remaining_bytes ?? 1) <= 0,
    onUpload: () => data.setFilePickerOpen(true),
  };
}
