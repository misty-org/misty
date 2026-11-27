import { lazy, Suspense, useEffect } from "react";
import {
  acceptList,
  listenForNativePicks,
  useFilePickRequest,
  type FilePickRequest,
} from "@/shared/lib/file_pick";

const FilePickDialog = lazy(() =>
  import("@/features/spaces/file-manager/FilePickDialog").then((module) => ({
    default: module.FilePickDialog,
  })),
);

export function FilePickHost() {
  useEffect(() => listenForNativePicks(), []);
  const request = useFilePickRequest((state) => state.request);
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <FilePickRequestDialog request={request} />
    </Suspense>
  );
}

function FilePickRequestDialog({ request }: { request: FilePickRequest }) {
  const { options } = request;
  const accept = acceptList(options.accept);
  if (request.kind === "files")
    return (
      <FilePickDialog
        key={request.id}
        choice={{ title: options.title, accept, multiple: options.multiple }}
        onPick={async (items) => {
          const { readItem } = await import("@/features/spaces/file-manager/file_drag");
          request.answer(await Promise.all(items.map(readItem)));
        }}
        onCancel={() => request.answer([])}
      />
    );
  return (
    <FilePickDialog
      key={request.id}
      choice={{
        title: options.title,
        accept,
        multiple: options.multiple,
        folders: request.options.folders,
        local: true,
        start: request.options.start ? { kind: "disk", path: request.options.start } : undefined,
      }}
      onPick={async (items) => {
        const { localPath } = await import("@/features/spaces/file-manager/model");
        request.answer(items.flatMap((item) => localPath(item) ?? []));
      }}
      onPickFolder={(path) => request.answer([path])}
      onCancel={() => request.answer([])}
    />
  );
}
