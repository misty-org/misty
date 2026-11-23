import { currentApiBase, useServerChoice } from "@/api/deployment/server_choice";
import { useUserStore } from "@/features/account";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { Space } from "../api/dto/entities";
import { useSpacesStore } from "../list/use_spaces_store";
import { driveNative, type DriveSpace } from "./drive_native";

let lastSent = "";
let lastAccount = "";
let lastServer = "";
let started = false;
let queue: Promise<unknown> = Promise.resolve();

function listIsAccounts(spaces: Space[], accountId: string): boolean {
  const own = spaces.filter((space) => space.is_default);
  if (!own.length) return true;
  return own.some((space) => space.owner_user_id === accountId);
}

function send(server: string, accountId: string, spaces: DriveSpace[]) {
  const key = JSON.stringify([server, accountId, spaces]);
  if (key === lastSent) return;
  lastSent = key;
  queue = queue.then(() =>
    driveNative.syncSpaces(server, accountId, spaces).catch(() => {
      if (lastSent === key) lastSent = "";
    }),
  );
}

function sync() {
  const accountId = useUserStore.getState().accountId;
  const server = currentApiBase();
  if (lastAccount && (lastAccount !== accountId || lastServer !== server))
    send(lastServer, lastAccount, []);
  lastAccount = accountId;
  lastServer = server;
  if (!accountId || !server) return;
  const { spaces, snapshotReady, referenceOnly } = useSpacesStore.getState();
  if (!snapshotReady || referenceOnly || !listIsAccounts(spaces, accountId)) return;
  send(
    server,
    accountId,
    spaces.map((space) => ({ id: space.id, name: space.name })),
  );
}

export function startDriveSpacesSync() {
  if (started || !hasTauriInternals()) return;
  started = true;
  useUserStore.subscribe(sync);
  useSpacesStore.subscribe(sync);
  useServerChoice.subscribe(sync);
  sync();
}
