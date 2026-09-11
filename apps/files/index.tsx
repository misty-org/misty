import "@/styles/styles.css";
import { createSdkFilesComponent } from "./workspace/createSdkFilesComponent";
import {
  defineComponentApp,
  type MistyComponentContext,
  type MistyFilePdfPreview,
  type MistyFileRenderer,
  type MistyFileVideoPreview,
  type MistyFilePhotoEditor,
} from "@misty/sdk";
import type { ReactNode } from "react";
import VideoAnnotator from "./workspace/explorer/components/VideoAnnotator";
import { PhotoEditorView } from "@/features/editor/PhotoEditorView";
import { createRoot } from "react-dom/client";
import { extractDocumentText } from "./workspace/explorer/components/globalPreview/previewDocument";
import PdfViewer from "./workspace/explorer/components/PdfViewerView";

function ErrorView({ error, title }: { error?: unknown; title?: string }) {
  return (
    <div role="alert" className="p-3 text-sm text-cream-muted">
      <strong>{title}</strong>
      <p>{String(error ?? "")}</p>
    </div>
  );
}
function renderer<T>(render: (preview: T) => ReactNode): MistyFileRenderer<T> {
  return (root, initial) => {
    const reactRoot = createRoot(root);
    let closed = false;
    const update = (preview: T) => {
      if (!closed) reactRoot.render(render(preview));
    };
    update(initial);
    return {
      update,
      unmount() {
        if (!closed) {
          closed = true;
          queueMicrotask(() => reactRoot.unmount());
        }
      },
    };
  };
}
const renderPdf = renderer<MistyFilePdfPreview>((preview) => (
  <PdfViewer {...preview} Error={ErrorView} />
));
const renderVideo = renderer<MistyFileVideoPreview>((preview) => (
  <VideoAnnotator {...preview} />
));
const renderPhoto = renderer<MistyFilePhotoEditor>((preview) => (
  <PhotoEditorView {...preview} Error={ErrorView} />
));

/** The package composes Misty's complete reusable file workspace and native transfer history. */
const legacyFiles = defineComponentApp({
  appId: "files",
  protocol: 2,
  async mount({ root, misty, context, signal }) {
    root.className = "h-full min-h-0";
    const options = (context: MistyComponentContext) => ({
      view:
        new URL(context.route, "https://misty.local").searchParams.get(
          "view",
        ) === "transfers"
          ? ("transfers" as const)
          : ("explorer" as const),
      active: context.active,
      extractDocumentText,
      renderPdf,
      renderVideo,
      renderPhoto,
    });
    await misty.navigation.setItems([
      { id: "explorer", label: "Explorer", route: "/apps/files" },
      {
        id: "transfers",
        label: "Transfers",
        route: "/apps/files?view=transfers",
      },
    ]);
    const workspace = await misty.fileSystem.mountWorkspace(
      root,
      options(context),
    );
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      workspace.unmount();
      signal?.removeEventListener("abort", close);
    };
    signal?.addEventListener("abort", close, { once: true });
    if (signal?.aborted) close();
    return {
      update(next) {
        if (!closed) workspace.update(options(next));
      },
      unmount: close,
    };
  },
});

const packagedFiles = createSdkFilesComponent();
export default defineComponentApp({
  appId: "files",
  protocol: 2,
  async createSession(input) {
    const session = await packagedFiles.createSession!(input);
    return {
      mount(context) { return context.context.devicePlatform === "macos" ? session.mount(context) : legacyFiles.mount(context); },
      close: () => session.close(),
    };
  },
  mount(input) {
    return (input.context.devicePlatform === "macos" ? packagedFiles : legacyFiles).mount(input);
  },
});
