import {
  clipboardPublishImageBytes,
  clipboardPublishShared,
  clipboardSetLocal,
} from "@/features/files/native";
import type { TransferRecord } from "@/native/contracts";
import { errorText } from "@/shared/lib/format";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { useExplorerStore } from "../../store";
import { clipboardImagePng } from "../../utils/clipboardImage";
import { textClipboardPayload } from "./clipboardPayloads";

export function newestUndoableTransfer(rows: readonly TransferRecord[]): TransferRecord | null {
  return (
    rows
      .filter((row) => row.undoable && row.undoTokenId > 0 && row.status === "completed")
      .sort(
        (left, right) => transferRecencyMs(right) - transferRecencyMs(left) || right.id - left.id,
      )[0] ?? null
  );
}

export function transferRecencyMs(row: TransferRecord): number {
  return row.completedAtMs || row.startedAtMs || row.queuedAtMs || row.id;
}

export function transferTypeLabel(type: TransferRecord["transferType"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export async function publishSharedClipboard(): Promise<void> {
  try {
    let published = await clipboardPublishShared();
    if (!published) {
      const systemText = await readText().catch(() => "");
      if (systemText.trim()) {
        await clipboardSetLocal(textClipboardPayload(systemText));
        published = await clipboardPublishShared();
      }
    }
    if (!published) {
      const image = await clipboardImagePng();
      if (image) {
        published = await clipboardPublishImageBytes({
          bytes: [...image.bytes],
          width: image.width,
          height: image.height,
          mimeType: "image/png",
        });
      }
    }
    if (!published) {
      useExplorerStore.setState({
        operationError:
          "Shared clipboard publish failed. Check that the local clipboard has content.",
      });
    }
  } catch (error) {
    useExplorerStore.setState({
      operationError: `Shared clipboard publish failed: ${errorText(error)}`,
    });
  }
}
