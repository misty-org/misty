/**
 * Whether this window's web view can edit video: the editor decodes, draws and encodes frames
 * with WebCodecs on an OffscreenCanvas. macOS's and Windows' web views have them; a web view
 * without them (some Linux systems) isn't offered the editor, and video files play instead.
 */
export function canEditVideo(): boolean {
  return (
    typeof globalThis.VideoDecoder === "function" &&
    typeof globalThis.VideoEncoder === "function" &&
    typeof globalThis.AudioDecoder === "function" &&
    typeof globalThis.AudioEncoder === "function" &&
    typeof globalThis.OffscreenCanvas === "function"
  );
}

/** What the editor and the agents' video tools say where video can't be edited. */
export const VIDEO_EDITING_UNAVAILABLE =
  "Editing video isn't possible on this computer: its web view can't encode video.";
