// Type-only import: erased at build time so the (heavy, konva-backed) editor is
// never pulled into the module graph until it is actually rendered.
import type { FilerobotImageEditorConfig } from "react-filerobot-image-editor";
import { Copy, Loader2, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useState,
  type FunctionComponent,
  type ReactNode,
} from "react";
import { Button } from "@/ui";
import "./photoEditor.css";

const FilerobotImageEditor = lazy(() => import("react-filerobot-image-editor"));

// filerobot's TABS/TOOLS enums live in the same module we lazy-load, so mirror
// the string values here to keep them out of the static import.
const TAB = {
  ADJUST: "Adjust",
  FINETUNE: "Finetune",
  FILTERS: "Filters",
  ANNOTATE: "Annotate",
  RESIZE: "Resize",
} as const;
const TOOL = { CROP: "Crop" } as const;

/** Rendered image handed back by filerobot on save. */
type RenderedImage = {
  imageCanvas?: HTMLCanvasElement;
  imageBase64?: string;
};

const CopyIcon: FunctionComponent = () => <Copy size={16} />;

// Dark palette tuned to match the app's editor chrome. Cast because
// @scaleflex/ui's ThemeOverride uses a fixed key set we only partly fill.
const filerobotTheme = {
  palette: {
    "bg-grey": "#191919",
    "bg-stateless": "#131313",
    "bg-active": "#3E3E3E",
    "bg-base-light": "#191919",
    "bg-base-medium": "#2B2B2B",
    "bg-primary": "#0F0F0F",
    "bg-primary-light": "#161616",
    "bg-primary-hover": "#2B2B2B",
    "bg-primary-active": "#3E3E3E",
    "bg-primary-0-5-opacity": "#0F0F0F",
    "bg-primary-stateless": "#191919",
    "bg-secondary": "#161616",
    "bg-hover": "#2B2B2B",
    "txt-primary": "#E0E0E0",
    "txt-secondary": "#8C8C8C",
    "txt-secondary-invert": "#131313",
    "txt-placeholder": "#8C8C8C",
    "accent-primary": "#A3BFAB",
    "accent-primary-hover": "#E0E0E0",
    "accent-primary-active": "#F1F1F1",
    "accent-primary-disabled": "#3E3E3E",
    "accent-secondary-disabled": "#2B2B2B",
    "accent-stateless": "#A3BFAB",
    "accent-stateless_0_4_opacity": "#52825A",
    accent_0_5_opacity: "#28312B",
    accent_1_2_opacity: "#28312B",
    "icons-primary": "#E0E0E0",
    "icons-secondary": "#8C8C8C",
    "icons-placeholder": "#8C8C8C",
    "icons-invert": "#131313",
    "icons-muted": "#8C8C8C",
    "icons-primary-hover": "#F1F1F1",
    "icons-secondary-hover": "#E0E0E0",
    "borders-primary": "#262626",
    "borders-primary-hover": "#3E3E3E",
    "borders-secondary": "#262626",
    "borders-strong": "#3E3E3E",
    "borders-disabled": "#262626",
    "borders-button": "#3E3E3E",
    "borders-item": "#262626",
    "btn-primary-text": "#131313",
    "btn-disabled-text": "#8C8C8C",
    "btn-secondary-text": "#E0E0E0",
    "link-primary": "#A3BFAB",
    "link-stateless": "#A3BFAB",
    "link-hover": "#E0E0E0",
    "link-active": "#F1F1F1",
    "link-pressed": "#F1F1F1",
    "link-muted": "#8C8C8C",
  },
  typography: { fontFamily: "inherit" },
} as FilerobotImageEditorConfig["theme"];

const filerobotTabs = [
  TAB.ADJUST,
  TAB.FINETUNE,
  TAB.FILTERS,
  TAB.ANNOTATE,
  TAB.RESIZE,
] as FilerobotImageEditorConfig["tabsIds"];

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
  if (image.imageBase64) return (await fetch(image.imageBase64)).blob();
  throw new Error("The editor did not produce an image.");
}

function EditorShell(props: { name: string; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[2147483300] bg-charcoal-workspace"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${props.name}`}
    >
      {props.children}
    </div>
  );
}

function EditorStatus(props: { name: string; error?: string; onClose: () => void }) {
  return (
    <EditorShell name={props.name}>
      <div className="grid h-full place-items-center text-sm text-cream-bright/60">
        <div className="grid justify-items-center gap-3">
          {props.error ? (
            <p className="max-w-sm text-center text-cream-bright">{props.error}</p>
          ) : (
            <>
              <Loader2 className="animate-spin" size={28} />
              Preparing image…
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-2 size-10 rounded-xl bg-charcoal-active text-cream-bright/60 hover:bg-charcoal-active hover:text-cream-bright"
            aria-label="Close editor"
            onClick={props.onClose}
          >
            <X size={19} />
          </Button>
        </div>
      </div>
    </EditorShell>
  );
}

export function PhotoEditor(props: PhotoEditorProps) {
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
    return <EditorStatus name={props.name} error={props.error} onClose={props.onClose} />;
  }

  return (
    <EditorShell name={props.name}>
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-cream-bright/60">
            <Loader2 className="animate-spin" size={28} />
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
        <p
          className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-charcoal-active px-3 py-2 text-xs text-cream-bright"
          role="status"
        >
          {saveError}
        </p>
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
