import type { ComponentProps } from "react";
import { fetchPreviewBytes } from "@/api/preview/api";
import { SystemErrorNotice } from "@/features/support/systemErrors";
import { EmbeddedUniversalPreviewView } from "./EmbeddedUniversalPreviewView";
import { extractDocumentText } from "./previewDocument";
export function EmbeddedUniversalPreview(
  props: Omit<ComponentProps<typeof EmbeddedUniversalPreviewView>, "runtime">,
) {
  return (
    <EmbeddedUniversalPreviewView
      {...props}
      runtime={{
        Error: SystemErrorNotice,
        readBytes: fetchPreviewBytes,
        extractDocumentText: extractDocumentText,
      }}
    />
  );
}
