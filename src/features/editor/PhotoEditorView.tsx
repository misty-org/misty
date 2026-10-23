// Type-only import: erased at build time so the (heavy, konva-backed) editor is
// never pulled into the module graph until it is actually rendered.
import type { PreviewErrorComponent } from "@/features/resource-preview/previewTypes";
import { IconButton, Skeleton, ViewportLayer } from "@/shared/ui";
import { Copy, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useState,
  type FunctionComponent,
  type ReactNode,
} from "react";
import { filerobotTabs, filerobotTheme, TAB, TOOL } from "./filerobotTheme";
import "./photoEditor.css";

const FilerobotImageEditor = lazy(() => import("react-filerobot-image-editor"));

/** Rendered image handed back by filerobot on save. */
type RenderedImage = {
  imageCanvas?: HTMLCanvasElement;
  imageBase64?: string;
};

const CopyIcon: FunctionComponent = () => <Copy size={16} />;

function savedImageType(mimeType: string): "png" | "jpeg" | "webp" {
  if (mimeType === "image/jpeg") return "jpeg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  const quality = mimeType === "image/png" ? undefined : 0.92;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The edited image could not be encoded.")),
      mimeType,
      quality,
    );
  });
}

async function renderedToBlob(image: RenderedImage, mimeType: string): Promise<Blob> {
  if (image.imageCanvas) return canvasToBlob(image.imageCanvas, mimeType);
  if (image.imageBase64) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(
      image.imageBase64,
    );
    if (!match) throw new Error("The editor did not produce an image data URL.");
    const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: match[1] });
  }
  throw new Error("The editor did not produce an image.");
}

function EditorShell(props: { name: string; children: ReactNode }) {
  return (
    <ViewportLayer
      layer="blocking-popup"
      className="bg-charcoal-workspace"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${props.name}`}
    >
      {props.children}
    </ViewportLayer>
  );
}

function EditorStatus(props: {
  name: string;
  error?: string;
  onClose: () => void;
  Error: PreviewErrorComponent;
}) {
  return (
    <EditorShell name={props.name}>
      <div className="grid h-full place-items-center text-sm text-cream-bright/60">
        <div className="grid justify-items-center gap-3">
          {props.error ? (
            <props.Error
              error={props.error}
              scope="files:photo-editor"
              title="Image could not be prepared"
            />
          ) : (
            <Skeleton
              role="status"
              aria-label="Image"
              aria-hidden={false}
              className="aspect-[4/3] w-[min(70vw,720px)] rounded-lg"
            />
          )}
          <IconButton
            size="lg"
            variant="default"
            label="Close editor"
            className="mt-2"
            onClick={props.onClose}
          >
            <X size={19} />
          </IconButton>
        </div>
      </div>
    </EditorShell>
  );
}

export function PhotoEditorView(props: PhotoEditorProps & { Error: PreviewErrorComponent }) {
  const mimeType = props.outputMimeType || "image/png";
  const [saveError, setSaveError] = useState("");
  const [, setBusy] = useState<null | "save" | "copy">(null);

  const persist = useCallback(
    async (image: RenderedImage, copy: boolean) => {
      if (props.readonly) return;
      setSaveError("");
      setBusy(copy ? "copy" : "save");
      try {
        const blob = await renderedToBlob(image, mimeType);
        if (copy) await props.onSaveAsCopy(blob);
        else await props.onSave(blob);
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : "The image could not be saved.");
      } finally {
        setBusy(null);
      }
    },
    [mimeType, props],
  );

  if (props.loading || props.error || !props.url) {
    return (
      <EditorStatus
        Error={props.Error}
        name={props.name}
        error={props.error}
        onClose={props.onClose}
      />
    );
  }

  return (
    <EditorShell name={props.name}>
      <Suspense
        fallback={
          <div className="grid h-full place-items-center">
            <Skeleton
              role="status"
              aria-label="Image"
              aria-hidden={false}
              className="aspect-[4/3] w-[min(70vw,720px)] rounded-lg"
            />
          </div>
        }
      >
        <FilerobotImageEditor
          key={props.sourceKey}
          source={props.url}
          backgroundColor="#0F0F0F"
          theme={filerobotTheme}
          tabsIds={filerobotTabs}
          defaultTabId={TAB.ADJUST}
          defaultToolId={TOOL.CROP}
          savingPixelRatio={1}
          previewPixelRatio={typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1}
          defaultSavedImageName={props.name.replace(/\.[^.]+$/, "") || "image"}
          defaultSavedImageType={savedImageType(mimeType)}
          useBackendTranslations={false}
          avoidChangesNotSavedAlertOnLeave
          removeSaveButton={props.readonly}
          onBeforeSave={() => false}
          onSave={(image) => persist(image as RenderedImage, false)}
          moreSaveOptions={
            props.readonly
              ? undefined
              : [
                  {
                    label: "Save as a copy",
                    icon: CopyIcon,
                    onClick: (
                      _openSaveModal: (fn: (image: RenderedImage) => void) => void,
                      triggerSaving: (fn: (image: RenderedImage) => void) => void,
                    ) => triggerSaving((image) => void persist(image, true)),
                  },
                ]
          }
          onClose={() => (props.onCancel ?? props.onClose)()}
        />
      </Suspense>
      {saveError ? (
        <props.Error
          error={saveError}
          scope="files:photo-editor:save"
          title="Edited image could not be saved"
        />
      ) : null}
    </EditorShell>
  );
}

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
