import { useAppStore } from "@/features/app-shell";
import { selectAdvancedPreferences, useSettingsStore } from "@/features/settings";
import {
  clipboardApplyShared,
  clipboardSharedImageBytes,
  clipboardWriteFileRefs,
  explorerPrepareDragItems,
} from "@/services/backend";
import type { ClipboardPayload } from "@/services/misty/model/misty-api";
import { errorText } from "@/shared/lib/format";
import { writeHtml, writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useExplorerStore } from "../../store";

export function textClipboardPayload(text: string): ClipboardPayload {
  return {
    kind: text ? "text" : "empty",
    origin: "local_system",
    payload_id: "",
    source_device_id: "",
    source_device_name: "",
    revision: 0,
    created_unix_ms: 0,
    text,
    html: "",
    file_refs: [],
    images: [],
  };
}

export async function applySharedClipboardToSystem(): Promise<void> {
  try {
    const payload = await clipboardApplyShared();
    await writeSharedClipboardPayload(payload);
  } catch (error) {
    useExplorerStore.setState({
      operationError: `Shared clipboard apply failed: ${errorText(error)}`,
    });
  }
}

export async function writeSharedClipboardPayload(payload: ClipboardPayload): Promise<void> {
  switch (payload.kind) {
    case "text":
      if (!payload.text) break;
      await writeText(payload.text);
      return;
    case "html":
      if (!payload.html && !payload.text) break;
      if (payload.html) await writeHtml(payload.html, payload.text || undefined);
      else await writeText(payload.text);
      return;
    case "file_refs": {
      const localItems = sharedClipboardLocalPasteItems(payload);
      const remoteItems = await sharedClipboardRemotePasteItems(payload);
      const nativeItems = [...localItems, ...remoteItems];
      if (nativeItems.length > 0 && (await clipboardWriteFileRefs(nativeItems))) {
        if (remoteItems.length > 0) {
          useExplorerStore
            .getState()
            .pushNotification(
              `Prepared ${remoteItems.length} shared remote ${remoteItems.length === 1 ? "item" : "items"} for clipboard.`,
              "success",
              3500,
              false,
            );
        }
        return;
      }
      const text = sharedClipboardText(payload);
      if (!text) break;
      await writeText(text);
      return;
    }
    case "image": {
      const image = payload.images.find((candidate) => candidate.blob_id);
      if (!image) break;
      const bytes = await clipboardSharedImageBytes(image.blob_id);
      await writeImage(new Uint8Array(bytes));
      return;
    }
    case "empty":
      break;
  }
  throw new Error("This shared clipboard payload cannot be applied to the system clipboard yet.");
}

export function sharedClipboardText(payload: ClipboardPayload): string {
  switch (payload.kind) {
    case "text":
      return payload.text;
    case "html":
      return payload.html || payload.text;
    case "file_refs":
      return payload.file_refs
        .map((ref) => ref.local_path || sharedClipboardRemoteLabel(ref))
        .filter(Boolean)
        .join("\n");
    default:
      return "";
  }
}

export function sharedClipboardRemoteLabel(ref: ClipboardPayload["file_refs"][number]): string {
  const providerType = clipboardRefValue(ref.provider_type);
  const remoteName = clipboardRefValue(ref.remote_name);
  const remotePath = clipboardRefValue(ref.remote_path);
  if (!remoteName && !remotePath) return "";
  const provider = providerType ? `${providerType}/` : "";
  return `${provider}${remoteName}:${remotePath}`;
}

export function sharedClipboardLocalPasteItems(payload: ClipboardPayload) {
  return payload.file_refs
    .map((ref) => ({
      path: clipboardRefValue(ref.local_path),
      remoteName: clipboardRefValue(ref.remote_name),
      remotePath: clipboardRefValue(ref.remote_path),
      isDirectory: ref.is_dir,
    }))
    .filter((ref) => ref.path && !ref.remoteName && !ref.remotePath)
    .map((ref) => ({ path: ref.path, isDirectory: ref.isDirectory }));
}

export async function sharedClipboardRemotePasteItems(payload: ClipboardPayload) {
  const remoteRefs = payload.file_refs
    .map((ref) => ({
      providerType: clipboardRefValue(ref.provider_type),
      remoteName: clipboardRefValue(ref.remote_name),
      remotePath: clipboardRefValue(ref.remote_path),
      localPath: clipboardRefValue(ref.local_path),
      isDirectory: ref.is_dir,
    }))
    .filter((ref) => !ref.localPath && ref.providerType && ref.remoteName && ref.remotePath);
  if (remoteRefs.length === 0) return [];
  useExplorerStore
    .getState()
    .pushNotification(
      `Preparing ${remoteRefs.length} shared remote ${remoteRefs.length === 1 ? "item" : "items"} for clipboard...`,
      "info",
      3500,
      false,
    );
  try {
    const prepared = await explorerPrepareDragItems({
      items: remoteRefs.map((ref) => ({
        path: remoteClipboardMountPath(ref),
        isDirectory: ref.isDirectory,
      })),
    });
    if (prepared.skipped.length > 0) {
      useExplorerStore
        .getState()
        .pushNotification(
          `Skipped ${prepared.skipped.length} shared remote ${prepared.skipped.length === 1 ? "item" : "items"} while preparing clipboard.`,
          "error",
          4500,
          false,
        );
    }
    return prepared.items.map((item) => ({ path: item.localPath, isDirectory: item.isDirectory }));
  } catch (error) {
    useExplorerStore
      .getState()
      .pushNotification(
        `Shared remote clipboard preparation failed: ${errorText(error)}`,
        "error",
        5500,
        false,
      );
    return [];
  }
}

export function remoteClipboardMountPath(ref: {
  providerType: string;
  remoteName: string;
  remotePath: string;
}): string {
  const app = useAppStore.getState().app;
  const homePath = app?.environment.homeDir ?? "/";
  const settingsMountPath = selectAdvancedPreferences(
    useSettingsStore.getState().settings?.document,
  ).mountPath;
  const mountRoot = resolveMountRoot(
    homePath,
    settingsMountPath || app?.environment.mountPath || ".misty/mnt",
  );
  return joinPath(mountRoot, ref.remoteName, ref.remotePath);
}

export function clipboardRefValue(value: string): string {
  return value.trim();
}

function resolveMountRoot(homePath: string, configuredPath: string): string {
  if (configuredPath.startsWith("/")) return configuredPath;
  return joinPath(homePath, configuredPath);
}

function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts.filter(Boolean);
  if (!first) return "/";
  return (
    [first.replace(/\/+$/, ""), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))]
      .filter(Boolean)
      .join("/") || "/"
  );
}
