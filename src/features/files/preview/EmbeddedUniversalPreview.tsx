import { lazy, Suspense, type ComponentProps } from "react";
import { fetchPreviewBytes } from "../api/api";
import { SystemErrorNotice } from "@/shared/platform/system_errors";
import type { EmbeddedUniversalPreviewView as PreviewView } from "./EmbeddedUniversalPreviewView";
import { extractDocumentText } from "./preview_document";

const EmbeddedUniversalPreviewView = lazy(() =>
  import("./EmbeddedUniversalPreviewView").then((module) => ({
    default: module.EmbeddedUniversalPreviewView,
  })),
);

export function EmbeddedUniversalPreview(
  props: Omit<ComponentProps<typeof PreviewView>, "runtime">,
) {
  return (
    <Suspense fallback={null}>
      <EmbeddedUniversalPreviewView
        {...props}
        runtime={{
          Error: SystemErrorNotice,
          readBytes: fetchPreviewBytes,
          extractDocumentText: extractDocumentText,
        }}
      />
    </Suspense>
  );
}
