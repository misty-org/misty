import type { PhotoEditorProps } from "@/models/interfaces/features/editor/PhotoEditor";
export type { PhotoEditorProps } from "@/models/interfaces/features/editor/PhotoEditor";
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
    "bg-grey": "#1a1c22",
    "bg-stateless": "#111216",
    "bg-active": "#20232a",
    "bg-base-light": "#20232a",
    "bg-base-medium": "#2a2d34",
    "bg-primary": "#0b0c0f",
    "bg-primary-light": "#111216",
    "bg-primary-hover": "#15171c",
    "bg-primary-active": "#1a1c22",
    "bg-primary-0-5-opacity": "rgba(11, 12, 15, 0.5)",
    "bg-primary-stateless": "#2a2d34",
    "bg-secondary": "#111216",
    "bg-hover": "#1a1c22",
    "txt-primary": "#f3f5f7",
    "txt-secondary": "#c7cdd3",
    "txt-secondary-invert": "#0b0c0f",
    "txt-placeholder": "#7d848d",
    "accent-primary": "#e7edf3",
    "accent-primary-hover": "#ffffff",
    "accent-primary-active": "#ffffff",
    "accent-primary-disabled": "#2a2d34",
    "accent-secondary-disabled": "#15171c",
    "accent-stateless": "#e7edf3",
    "accent-stateless_0_4_opacity": "rgba(231, 237, 243, 0.4)",
    accent_0_5_opacity: "rgba(231, 237, 243, 0.05)",
    accent_1_2_opacity: "rgba(231, 237, 243, 0.12)",
    "icons-primary": "#f3f5f7",
    "icons-secondary": "#c7cdd3",
    "icons-placeholder": "#7d848d",
    "icons-invert": "#0b0c0f",
    "icons-muted": "#7d848d",
    "icons-primary-hover": "#ffffff",
    "icons-secondary-hover": "#f3f5f7",
    "borders-primary": "#2a2d34",
    "borders-primary-hover": "#3a3d44",
    "borders-secondary": "#20232a",
    "borders-strong": "#3a3d44",
    "borders-disabled": "#2a2d34",
    "borders-button": "#3a3d44",
    "borders-item": "#20232a",
    "btn-primary-text": "#17191c",
    "btn-disabled-text": "#7d848d",
    "btn-secondary-text": "#f3f5f7",
    "link-primary": "#c7cdd3",
    "link-stateless": "#c7cdd3",
    "link-hover": "#ffffff",
    "link-active": "#ffffff",
    "link-pressed": "#ffffff",
    "link-muted": "#7d848d",
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
      className="fixed inset-0 z-[2147483300] bg-[#0b0c0f]"
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
      <div className="grid h-full place-items-center text-sm text-white/60">
        <div className="grid justify-items-center gap-3">
          {props.error ? (
            <p className="max-w-sm text-center text-red-200">{props.error}</p>
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
            className="mt-2 size-10 rounded-xl bg-white/[0.08] text-white/60 hover:bg-white/15 hover:text-white"
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
          <div className="grid h-full place-items-center text-white/60">
            <Loader2 className="animate-spin" size={28} />
          </div>
        }
      >
        <FilerobotImageEditor
          key={props.sourceKey}
          source={props.url}
          backgroundColor="#0b0c0f"
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
          className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-200"
          role="status"
        >
          {saveError}
        </p>
      ) : null}
    </EditorShell>
  );
}
