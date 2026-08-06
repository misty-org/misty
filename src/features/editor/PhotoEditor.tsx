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
    "bg-grey": "#1A1918",
    "bg-stateless": "#141312",
    "bg-active": "#443E38",
    "bg-base-light": "#1A1918",
    "bg-base-medium": "#2E2B29",
    "bg-primary": "#100F0E",
    "bg-primary-light": "#171615",
    "bg-primary-hover": "#2E2B29",
    "bg-primary-active": "#443E38",
    "bg-primary-0-5-opacity": "#100F0E",
    "bg-primary-stateless": "#1A1918",
    "bg-secondary": "#171615",
    "bg-hover": "#2E2B29",
    "txt-primary": "#E6E1DA",
    "txt-secondary": "#948D84",
    "txt-secondary-invert": "#141312",
    "txt-placeholder": "#948D84",
    "accent-primary": "#A3BFAB",
    "accent-primary-hover": "#E6E1DA",
    "accent-primary-active": "#F5F2ED",
    "accent-primary-disabled": "#443E38",
    "accent-secondary-disabled": "#2E2B29",
    "accent-stateless": "#A3BFAB",
    "accent-stateless_0_4_opacity": "#52825A",
    accent_0_5_opacity: "#28312B",
    accent_1_2_opacity: "#28312B",
    "icons-primary": "#E6E1DA",
    "icons-secondary": "#948D84",
    "icons-placeholder": "#948D84",
    "icons-invert": "#141312",
    "icons-muted": "#948D84",
    "icons-primary-hover": "#F5F2ED",
    "icons-secondary-hover": "#E6E1DA",
    "borders-primary": "#292624",
    "borders-primary-hover": "#443E38",
    "borders-secondary": "#292624",
    "borders-strong": "#443E38",
    "borders-disabled": "#292624",
    "borders-button": "#443E38",
    "borders-item": "#292624",
    "btn-primary-text": "#141312",
    "btn-disabled-text": "#948D84",
    "btn-secondary-text": "#E6E1DA",
    "link-primary": "#A3BFAB",
    "link-stateless": "#A3BFAB",
    "link-hover": "#E6E1DA",
    "link-active": "#F5F2ED",
    "link-pressed": "#F5F2ED",
    "link-muted": "#948D84",
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
          backgroundColor="#100F0E"
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
