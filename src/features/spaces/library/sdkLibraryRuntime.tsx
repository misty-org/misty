import { createSdkFilePicker } from "@/features/picker/createSdkFilePicker";
import { useEffect } from "react";
import { create } from "zustand";
import {
  libraryOperations,
  libraryReadOperations,
  type MistyAppSDK,
  type MistyComponentContext,
  type MistyLibraryOperation,
  type MistyLibraryReadOperation,
} from "@misty/sdk";
import { PhotoEditorView } from "@/features/editor/PhotoEditorView";
import { EmbeddedUniversalPreviewView } from "@/features/files/explorer/components/globalPreview/EmbeddedUniversalPreviewView";
import { useSDKSurfaceRegistration } from "@/features/ai-surface/SDKSurfaceRegistration";
import { configureLibraryRuntime, type LibraryRuntime } from "./libraryRuntime";
import type { LibraryUploadOptions } from "@/api/spaces/library-upload";
import type { SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";

export async function createSdkLibraryRuntime(
  misty: MistyAppSDK,
  context: MistyComponentContext,
  signal: AbortSignal,
  report: (error: unknown) => void,
) {
  const identity = await misty.context.get();
  if (!identity.space?.id) throw new Error("Open Library in a Space.");
  const spaceId = identity.space.id;
  const space = await misty.server.call("spaces.get", { path: { spaceID: spaceId } });
  const state = create(() => ({ spaces: [space], referenceOnly: false }));
  let current = context,
    closed = false;
  const files = new Map<string, File>();
  const assert = () => {
    if (closed || signal.aborted) throw new Error("This Library view is closed.");
  };
  const upload = async (
    blob: Blob,
    name: string,
    purpose: "library" | "attachment",
    options?: LibraryUploadOptions,
    replace?: SpaceLibraryItem,
  ) => {
    assert();
    options?.onStage?.("reading");
    const bytes = await blob.arrayBuffer();
    assert();
    options?.onStage?.("uploading");
    const result = await misty.library.upload({
      bytes,
      name,
      mimeType: blob.type,
      purpose,
      conversationId: options?.conversationId,
      replace: replace ? { itemId: replace.id, itemVersion: replace.version } : undefined,
    });
    assert();
    options?.onProgress?.(1);
    options?.onStage?.("finalizing");
    return result;
  };
  const api = new Proxy({} as LibraryRuntime["api"], {
    get(_target, key) {
      if (key === "uploadLibraryBlob")
        return (
          _space: string,
          blob: Blob,
          name: string,
          purpose: "library" | "attachment" = "library",
          options?: LibraryUploadOptions,
        ) => upload(blob, name, purpose, options);
      if (key === "replaceLibraryItemContent")
        return (
          _space: string,
          item: SpaceLibraryItem,
          blob: Blob,
          name: string,
          options?: LibraryUploadOptions,
        ) => upload(blob, name, "library", options, item);
      if (key === "uploadLibraryPath")
        return async (
          _space: string,
          path: string,
          purpose: "library" | "attachment",
          options?: LibraryUploadOptions,
        ) => {
          const file = files.get(path);
          if (!file) throw new Error("Choose the file again.");
          try {
            return await upload(file, file.name, purpose, options);
          } finally {
            files.delete(path);
          }
        };
      if (libraryReadOperations.includes(key as MistyLibraryReadOperation))
        return async (...args: unknown[]) => {
          assert();
          const value = await misty.library.read(key as MistyLibraryReadOperation, wireArgs(args));
          assert();
          return new Blob([value.bytes], { type: value.mimeType });
        };
      if (libraryOperations.includes(key as MistyLibraryOperation))
        return async (...args: unknown[]) => {
          assert();
          const result = await misty.library.perform(key as MistyLibraryOperation, wireArgs(args));
          assert();
          return result;
        };
      throw new Error(`Library operation ${String(key)} is unavailable.`);
    },
  });
  const ErrorView: LibraryRuntime["Error"] = (props) => (
    <div role="alert" className="px-3 py-2 text-sm text-cream">
      {String(props.error ?? "Library needs attention.")}
    </div>
  );
  const Picker = createSdkFilePicker(
    misty,
    (file) => {
      const path = `misty-library-upload/${crypto.randomUUID()}/${file.name}`;
      files.set(path, file);
      return path;
    },
    report,
  );
  const runtime: LibraryRuntime = {
    api,
    useSpacesStore: state as unknown as LibraryRuntime["useSpacesStore"],
    useWorkspaceTabTitle: (_id, title) =>
      useEffect(() => {
        void misty.workspace.setTitle(title).catch(report);
      }, [title]),
    useWorkspaceTabFocused: () => current.active && (current.focused ?? current.active),
    useAiSurfaceAdapter: (adapter) =>
      useSDKSurfaceRegistration({ misty, adapter: adapter ?? null, report }),
    useShortcutHandler: (id, handler, enabled = true) =>
      useEffect(() => {
        if (!enabled) return;
        const listener = (event: KeyboardEvent) => {
          if (
            !current.active ||
            current.focused === false ||
            (event.target instanceof Element &&
              event.target.closest("input,textarea,[contenteditable=true]"))
          )
            return;
          if (
            id === "library.copy" &&
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "c"
          ) {
            event.preventDefault();
            handler();
          }
        };
        window.addEventListener("keydown", listener);
        return () => window.removeEventListener("keydown", listener);
      }, [id, handler, enabled]),
    Picker,
    Error: ErrorView,
    Preview: (props) => (
      <EmbeddedUniversalPreviewView
        {...props}
        runtime={{
          Error: ErrorView,
          readBytes: async (url, abort) => {
            if (!url.startsWith("blob:")) throw new Error("The preview is unavailable.");
            return (await fetch(url, { signal: abort })).arrayBuffer();
          },
        }}
      />
    ),
    PhotoEditor: (props) => <PhotoEditorView {...props} Error={ErrorView} />,
    confirm: async (message) => window.confirm(message),
    copyFiles: async (values) => {
      await misty.library.copyFiles(
        await Promise.all(
          values.map(async (file) => ({ name: file.name, bytes: await file.blob.arrayBuffer() })),
        ),
      );
    },
  };
  const release = configureLibraryRuntime(runtime);
  return {
    spaceId,
    api,
    runtime,
    update(value: MistyComponentContext) {
      current = value;
    },
    close() {
      closed = true;
      files.clear();
      release();
    },
  };
}

function wireArgs(args: unknown[]) {
  const values = [...args];
  while (values.length && values[values.length - 1] === undefined) values.pop();
  return JSON.parse(JSON.stringify(values));
}
