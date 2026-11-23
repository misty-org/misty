import type { ComponentProps } from "react";
import { fetchPreviewBytes } from "../api/api";
import { SystemErrorNotice } from "@/shared/platform/system_errors";
import { EmbeddedUniversalPreviewView } from "./EmbeddedUniversalPreviewView";
import { extractDocumentText } from "./preview_document";
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
