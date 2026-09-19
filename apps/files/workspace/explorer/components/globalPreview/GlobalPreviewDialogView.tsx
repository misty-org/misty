import { PhotoEditorView } from "@/features/editor/PhotoEditorView";
import { errorText } from "@/shared/lib/format";
import { Button, Dialog, DialogContent, DialogTitle } from "@/shared/ui";
import { Copy, ExternalLink, FileQuestion, Loader2, Save, X } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import type { GlobalPreviewSource } from "../../model/interfaces/components/GlobalPreview";
import { formatBytes, formatDate } from "../../utils/fileFormat";
import { PreviewBodyView } from "./PreviewBodyView";
import { fileName, friendlyType, imageOutputMimeType, sourceExtension } from "./previewFormat";
import { InspectorDetail, PreviewMessage, ToolbarButton } from "./previewPrimitives";
import { globalPreviewKindForSource } from "./previewDocument";
import { usePreviewResource } from "./usePreviewResource";
import type { PreviewRuntime } from "./PreviewRuntime";

export function GlobalPreviewDialogView(props: {
  runtime: PreviewRuntime;
  source: GlobalPreviewSource;
  onClose: () => void;
  onSaved?: (path: string, copy: boolean) => void | Promise<void>;
  onSaveMetadata?: (caption: string, tags: string[]) => void | Promise<void>;
}) {
  const { resource, loading, loadError, reload } = usePreviewResource(
    props.source,
    props.runtime.load,
  );
  const previewRef = useRef<HTMLDivElement>(null);
  const extension = sourceExtension(props.source);
  const [textDraft, setTextDraft] = useState("");
  const [editingText, setEditingText] = useState(false);
  const [saving, setSaving] = useState<"save" | "copy" | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSaveStatus(null);
    setSaveError(null);
  }, [props.source.path]);
  useEffect(() => {
    if (resource?.text !== undefined) setTextDraft(resource.text);
  }, [resource?.text]);

  const textDirty = Boolean(
    resource &&
    (resource.kind === "text" || resource.kind === "markdown") &&
    textDraft !== resource.text,
  );
  const imageEditorMode =
    globalPreviewKindForSource(extension, props.source.mimeType ?? undefined) === "image";
  const canEditText = Boolean(
    resource && (resource.kind === "text" || resource.kind === "markdown") && !props.source.remote,
  );
  const dirty = textDirty;

  const save = async (copy: boolean) => {
    if (!resource || saving || props.source.remote) return;
    setSaving(copy ? "copy" : "save");
    setSaveError(null);
    setSaveStatus(null);
    try {
      let bytes: Uint8Array;
      if (resource.kind === "text" || resource.kind === "markdown") {
        bytes = new TextEncoder().encode(textDraft);
      } else {
        return;
      }
      const savedPath = await props.runtime.save(props.source, bytes, copy);
      setSaveStatus(copy ? `Saved copy as ${fileName(savedPath)}` : "Saved");
      if (!copy) {
        resource.text = textDraft;
        setEditingText(false);
      }
      await props.onSaved?.(savedPath, copy);
    } catch (reason) {
      setSaveError(errorText(reason));
    } finally {
      setSaving(null);
    }
  };
  props.runtime.useSaveShortcut(
    () => void save(false),
    canEditText && !props.source.readonly && !saving,
    previewRef,
  );

  const saveImageBlob = async (blob: Blob, copy: boolean) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const savedPath = await props.runtime.save(props.source, bytes, copy);
    if (!copy) await reload();
    await props.onSaved?.(savedPath, copy);
  };

  if (imageEditorMode)
    return (
      <PhotoEditorView
        Error={props.runtime.Error}
        sourceKey={props.source.path}
        name={props.source.name}
        url={resource?.url ?? ""}
        tags={props.source.tags}
        outputMimeType={imageOutputMimeType(extension)}
        loading={loading}
        error={loadError ?? undefined}
        readonly={props.source.readonly || props.source.remote}
        onClose={props.onClose}
        onSave={async (blob) => saveImageBlob(blob, false)}
        onSaveAsCopy={async (blob) => saveImageBlob(blob, true)}
      />
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) props.onClose();
      }}
    >
      {loadError ? (
        <props.runtime.Error
          error={loadError}
          scope="files:preview:load"
          title="File preview could not be loaded"
          target={{ kind: "workspace-tool", tool: "files" }}
        />
      ) : null}
      {saveError ? (
        <props.runtime.Error
          error={saveError}
          scope="files:preview:save"
          title="File preview changes could not be saved"
          target={{ kind: "workspace-tool", tool: "files" }}
        />
      ) : null}
      <DialogContent
        ref={previewRef}
        aria-describedby={undefined}
        className="left-0 top-0 block h-full w-full max-w-none translate-x-0 translate-y-0 rounded-none bg-charcoal-bg p-0 text-cream shadow-none ring-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 [&>[data-slot=dialog-close]]:hidden"
      >
        <section className="grid h-full min-h-0 grid-rows-[58px_minmax(0,1fr)]">
          <header className="grid min-w-0 grid-cols-[minmax(180px,1fr)_auto_minmax(180px,1fr)] items-center gap-3 border-b border-charcoal-border px-4">
            <div className="min-w-0">
              <DialogTitle className="m-0 truncate text-sm font-semibold">
                {props.source.name}
              </DialogTitle>
              <span className="block truncate text-[11px] text-cream-muted">
                {friendlyType(extension, props.source.mimeType)}
              </span>
            </div>
            <span />
            <div className="flex min-w-0 justify-end gap-2">
              {canEditText ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!dirty || Boolean(saving)}
                    onClick={() => void save(true)}
                  >
                    {saving === "copy" ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    Save as Copy
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!dirty || props.source.readonly || Boolean(saving)}
                    onClick={() => void save(false)}
                  >
                    {saving === "save" ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Save size={14} />
                    )}
                    Save
                  </Button>
                </>
              ) : null}
              <ToolbarButton label="Close preview" onClick={props.onClose}>
                <X size={18} />
              </ToolbarButton>
            </div>
          </header>
          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] max-[820px]:grid-cols-1">
            <main className="relative grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-charcoal-bg">
              {canEditText ? (
                <div className="flex min-h-12 items-center justify-center border-b border-charcoal-border bg-charcoal-card px-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingText((value) => !value)}
                  >
                    {editingText ? "Preview" : "Edit text"}
                  </Button>
                </div>
              ) : (
                <div />
              )}
              <div className="min-h-0 overflow-auto">
                {loading ? (
                  <PreviewMessage
                    icon={<Loader2 className="animate-spin" size={28} />}
                    title="Preparing preview"
                    detail="Loading the best available reader…"
                  />
                ) : null}
                {!loading && loadError ? (
                  <PreviewMessage
                    icon={<FileQuestion size={34} />}
                    title="Preview needs attention"
                    detail="Open Activity for details."
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void props.runtime.open(props.source)}
                      >
                        <ExternalLink size={14} />
                        Open in default app
                      </Button>
                    }
                  />
                ) : null}
                {!loading && resource ? (
                  <PreviewBodyView
                    runtime={props.runtime}
                    resource={resource}
                    source={props.source}
                    extension={extension}
                    textDraft={textDraft}
                    editingText={editingText}
                    onTextChange={(value) => {
                      setTextDraft(value);
                      setSaveStatus(null);
                    }}
                  />
                ) : null}
              </div>
            </main>
            <aside className="min-h-0 overflow-y-auto border-l border-charcoal-border bg-charcoal-card p-5 max-[820px]:hidden">
              <div className="grid gap-5">
                <div>
                  <span className="text-[11px] font-medium text-cream-muted">Inspector</span>
                  <h2 className="m-0 mt-2 break-words text-lg font-semibold">
                    {props.source.name}
                  </h2>
                </div>
                <dl className="m-0 grid gap-4">
                  <InspectorDetail
                    label="Kind"
                    value={friendlyType(extension, resource?.mimeType ?? props.source.mimeType)}
                  />
                  <InspectorDetail
                    label="Size"
                    value={
                      props.source.sizeBytes == null ? "—" : formatBytes(props.source.sizeBytes)
                    }
                  />
                  <InspectorDetail label="Modified" value={formatDate(props.source.modifiedMs)} />
                  {props.source.createdMs != null ? (
                    <InspectorDetail label="Created" value={formatDate(props.source.createdMs)} />
                  ) : null}
                  <InspectorDetail label="Path" value={props.source.path} />
                </dl>
                {props.source.description ? (
                  <div>
                    <span className="text-[11px] font-medium text-cream-muted">Description</span>
                    <p className="m-0 mt-2 text-sm leading-6 text-cream-muted">
                      {props.source.description}
                    </p>
                  </div>
                ) : null}
                {saveStatus ? (
                  <p
                    className="m-0 rounded-lg bg-sage-bg px-3 py-2 text-xs text-sage-fg"
                    role="status"
                  >
                    {saveStatus}
                  </p>
                ) : null}
                {props.source.remote ? (
                  <p className="m-0 rounded-lg bg-sage-bg px-3 py-2 text-xs leading-5 text-sage-fg">
                    Remote previews are read-only. Download the file to edit it.
                  </p>
                ) : null}
              </div>
            </aside>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
