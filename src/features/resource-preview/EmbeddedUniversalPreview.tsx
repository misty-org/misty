import type { ComponentProps } from "react";
import { fetchPreviewBytes } from "@/api/preview/api";
import { SystemErrorActivity } from "@/features/activity";
import {
  EmbeddedUniversalPreviewView,
  useEmbeddedDocument as useEmbeddedDocumentView,
} from "./EmbeddedUniversalPreviewView";
import { extractDocumentText } from "@/features/files/workspace/previews";
export function EmbeddedUniversalPreview(
  props: Omit<ComponentProps<typeof EmbeddedUniversalPreviewView>, "runtime">,
) {
  return (
    <EmbeddedUniversalPreviewView
      {...props}
      runtime={{
        Error: SystemErrorActivity,
        readBytes: fetchPreviewBytes,
        extractDocumentText: extractDocumentText,
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
    extractDocumentText,
  );
}
