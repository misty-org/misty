import { useEffect, useState } from "react";
import type { FileMetadataSnapshot } from "@/native/contracts";
import type { FileInspectorRuntime } from "./explorer/components/FileInspectorView";
import type { LoadedInspectorPreview } from "./explorer/model/interfaces/components/FileInspectorPreview";
import type { SdkFilesStore } from "./sdkFilesStore";
import type { PreviewRuntime } from "./explorer/components/globalPreview/PreviewRuntime";
import { sdkFilesPathPresentation } from "./sdkFilesNavigation";

export function createSdkFilesInspector(files: SdkFilesStore, preview: PreviewRuntime): FileInspectorRuntime {
  return {
    preview,
    displayPath: path => sdkFilesPathPresentation(files.store.getState().folders, path).displayPath,
    useFilePreview(entry, enabled = true) {
      const [state, setState] = useState({ preview: null as LoadedInspectorPreview | null, previewError: null as string | null, previewLoading: false });
      useEffect(() => {
        const lifetime = new AbortController();
        let url: string | undefined;
        setState({ preview: null, previewError: null, previewLoading: Boolean(entry && enabled && entry.kind === "file") });
        if (!entry || !enabled || entry.kind !== "file") return;
        const timer = window.setTimeout(() => {
          void preview.load(entry, lifetime.signal).then(resource => {
            url = resource.url;
            if (lifetime.signal.aborted) {
              if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
              return;
            }
            const kind = resource.kind === "markdown" || resource.kind === "document" ? "text" : resource.kind;
            setState({ preview: kind === "generic" ? null : {...resource, kind, url: resource.url ?? "", text: resource.text ?? null}, previewError: null, previewLoading: false });
          }).catch(error => {
            if (!lifetime.signal.aborted) setState({ preview: null, previewError: String(error), previewLoading: false });
          });
        }, 120);
        return () => { lifetime.abort(); window.clearTimeout(timer); if (url?.startsWith("blob:")) URL.revokeObjectURL(url); };
      }, [entry, enabled]);
      return state;
    },
    useFileMetadata(entry) {
      const [state, setState] = useState({ metadata: null as FileMetadataSnapshot | null, metadataError: null as string | null });
      useEffect(() => {
        let closed = false;
        setState({ metadata: null, metadataError: null });
        if (!entry) return;
        void files.owner(entry.path).stat(entry.path).then(stat => {
          if (!closed) setState({metadata: {path: entry.path, kind: stat.kind, sizeBytes: stat.bytes, readonly: stat.readOnly, hidden: entry.hidden, createdMs: stat.createdMs, modifiedMs: stat.modifiedMs, osTags: [], fields: [], extracted: []}, metadataError: null});
        }).catch(error => { if (!closed) setState({metadata: null, metadataError: String(error)}); });
        return () => { closed = true; };
      }, [entry]);
      return state;
    },
    useFolderPreview(entry, listing) {
      const [state, setState] = useState({ entries: [] as NonNullable<typeof listing>["entries"], loading: false, error: null as string | null });
      useEffect(() => {
        let closed = false;
        setState({entries: [], loading: entry?.kind === "folder", error: null});
        if (entry?.kind !== "folder") return;
        void (listing?.path === entry.path ? Promise.resolve(listing) : files.owner(entry.path).list({path: entry.path})).then(result => {
          if (!closed) setState({entries: result.entries.slice(0, 8), loading: false, error: null});
        }).catch(error => { if (!closed) setState({entries: [], loading: false, error: String(error)}); });
        return () => { closed = true; };
      }, [entry, listing]);
      return state;
    },
  };
}
