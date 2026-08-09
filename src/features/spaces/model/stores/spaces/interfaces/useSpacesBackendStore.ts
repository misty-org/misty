export interface LibraryUploadOptions {
  signal?: AbortSignal;
  conversationId?: string;
  onProgress?: (progress: number) => void;
  onStage?: (stage: "reading" | "hashing" | "uploading" | "finalizing") => void;
}
