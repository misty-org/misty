import type { GlobalPreviewSource } from "@/models/interfaces/features/explorer/components/GlobalPreview";
import { Button } from "@/ui";
import { Dialog, DialogContent, DialogTitle } from "@/ui";
import { Copy, ExternalLink, FileQuestion, Loader2, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { explorerOpenPath, explorerSavePreviewItem } from "@/stores/backend";
import { errorText } from "@/lib/format";
import { formatBytes, formatDate } from "../../utils/fileFormat";
import { PhotoEditor } from "../../../editor/PhotoEditor";
import { PreviewBody } from "./PreviewBody";
import { fileName, friendlyType, imageOutputMimeType, sourceExtension } from "./previewFormat";
import { InspectorDetail, PreviewMessage, ToolbarButton } from "./previewPrimitives";
import { globalPreviewKindForSource, useGlobalPreviewResource } from "./useGlobalPreviewResource";

export function GlobalPreviewDialog(props: {
  source: GlobalPreviewSource;
  onClose: () => void;
  onSaved?: (path: string, copy: boolean) => void | Promise<void>;
  onSaveMetadata?: (caption: string, tags: string[]) => void | Promise<void>;
}) {
  const { resource, loading, loadError, reload } = useGlobalPreviewResource(props.source);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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
      let bytes: number[];
      if (resource.kind === "text" || resource.kind === "markdown") {
        bytes = [...new TextEncoder().encode(textDraft)];
      } else {
        return;
      }
      const result = await explorerSavePreviewItem({
        path: props.source.path,
        bytes,
        saveAsCopy: copy,
      });
      const savedPath = result.affectedPaths[0] ?? props.source.path;
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

  const saveImageBlob = async (blob: Blob, copy: boolean) => {
    const bytes = [...new Uint8Array(await blob.arrayBuffer())];
    const result = await explorerSavePreviewItem({
      path: props.source.path,
      bytes,
      saveAsCopy: copy,
    });
    const savedPath = result.affectedPaths[0] ?? props.source.path;
    if (!copy) await reload();
    await props.onSaved?.(savedPath, copy);
  };

  if (imageEditorMode)
    return (
      <PhotoEditor
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
      <DialogContent
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
                    detail={loadError}
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void explorerOpenPath(props.source.path)}
                      >
                        <ExternalLink size={14} />
                        Open in default app
                      </Button>
                    }
                  />
                ) : null}
                {!loading && resource ? (
                  <PreviewBody
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
                  <span className="text-[11px] font-medium uppercase tracking-wider text-cream-muted">
                    Inspector
                  </span>
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
                    <span className="text-[11px] font-medium uppercase tracking-wider text-cream-muted">
                      Description
                    </span>
                    <p className="m-0 mt-2 text-sm leading-6 text-cream-muted">
                      {props.source.description}
                    </p>
                  </div>
                ) : null}
                {saveStatus || saveError ? (
                  <p
                    className={`m-0 rounded-lg px-3 py-2 text-xs ${saveError ? "bg-charcoal-active text-cream-bright" : "bg-sage-bg text-sage-fg"}`}
                    role="status"
                  >
                    {saveError ?? saveStatus}
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
