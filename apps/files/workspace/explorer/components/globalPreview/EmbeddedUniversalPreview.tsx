import type { ComponentProps } from "react";
import { fetchPreviewBytes } from "@/api/preview/api";
import { SystemErrorActivity } from "@/features/activity";
import {
  EmbeddedUniversalPreviewView,
  useEmbeddedDocument as useEmbeddedDocumentView,
} from "./EmbeddedUniversalPreviewView";
import { useContext } from "react";
import { FilePreviewRenderersContext } from "@/features/apps/FilePdfPreview";
export function EmbeddedUniversalPreview(
  props: Omit<ComponentProps<typeof EmbeddedUniversalPreviewView>, "runtime">,
) {
  return (
    <EmbeddedUniversalPreviewView
      {...props}
      runtime={{
        Error: SystemErrorActivity,
        readBytes: fetchPreviewBytes,
        extractDocumentText: useContext(FilePreviewRenderersContext)
          .extractDocumentText,
      }}
    />
  );
}
export function useEmbeddedDocument(
  url: string,
  extension: string,
  mimeType: string,
  enabled: boolean,
) {
  return useEmbeddedDocumentView(
    url,
    extension,
    mimeType,
    enabled,
    fetchPreviewBytes,
    useContext(FilePreviewRenderersContext).extractDocumentText,
  );
}
