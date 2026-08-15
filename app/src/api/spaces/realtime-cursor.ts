import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";

const realtimeCursorKey = "misty:spaces:realtime-cursor";

function accountRealtimeCursorKey(accountId: string): string {
  return `${realtimeCursorKey}:${accountId}`;
}

export function readRealtimeCursor(accountId: string): number {
  try {
    return Number(readDeploymentStorageItem(accountRealtimeCursorKey(accountId))) || 0;
  } catch {
    return 0;
  }
}

export function writeRealtimeCursor(accountId: string, cursor: number) {
  try {
    window.localStorage.setItem(
      deploymentStorageKey(accountRealtimeCursorKey(accountId)),
      String(cursor),
    );
  } catch {
    /* cursor replay falls back to a snapshot */
  }
}
