export interface PhotoEditorProps {
  /** Remounts the editor when the underlying image changes. */
  sourceKey: string;
  /** File/display name, used for the default saved-image name. */
  name: string;
  /** Object URL (blob:/asset:) for the image to edit. */
  url: string;
  indexLabel?: string;
  tags?: string[];
  /** Preferred output MIME type; defaults to image/png. */
  outputMimeType?: string;
  loading?: boolean;
  error?: string;
  /** When true, the editor is view-only and both save actions are hidden. */
  readonly?: boolean;
  onClose: () => void;
  onCancel?: () => void;
  /** Save over the original. Receives the client-rendered image. */
  onSave: (rendered: Blob) => void | Promise<void>;
  /** Save the client-rendered image as a new copy. */
  onSaveAsCopy: (rendered: Blob) => void | Promise<void>;
}
