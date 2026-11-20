import { currentApiBase, useServerChoice } from "@/api/deployment/serverChoice";
import { useUserStore } from "@/features/account";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { Space } from "../api/dto/entities";
import { useSpacesStore } from "../list/useSpacesStore";
import { driveNative, type DriveSpace } from "./driveNative";

/** What was last sent to `drive_sync_spaces`, so the same list is never sent twice. */
let lastSent = "";
let lastAccount = "";
let lastServer = "";
let started = false;
/**
 * Calls go one after another: native runs commands at once, so an unmount for the account being left
 * could otherwise land after the mount for the next one and take it down.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Whether the Space list is the signed-in account's own: it holds that account's own Space. A list
 * from the account being left (an account switch clears it, but not always first) never mounts.
 */
function listIsAccounts(spaces: Space[], accountId: string): boolean {
  const own = spaces.filter((space) => space.is_default);
  // A server that marks no Space as anyone's own can't be checked; its list counts.
  if (!own.length) return true;
  return own.some((space) => space.owner_user_id === accountId);
}

function send(server: string, accountId: string, spaces: DriveSpace[]) {
  const key = JSON.stringify([server, accountId, spaces]);
  if (key === lastSent) return;
  lastSent = key;
  queue = queue.then(() =>
    driveNative.syncSpaces(server, accountId, spaces).catch(() => {
      // Asked again with the next change, or the next start.
      if (lastSent === key) lastSent = "";
    }),
  );
}

/** Tells native which Spaces this computer mounts, from who is signed in and which Spaces they're in. */
function sync() {
  const accountId = useUserStore.getState().accountId;
  const server = currentApiBase();
  // Signed out, or moved to another account or server: the drives mounted for the last one go.
  if (lastAccount && (lastAccount !== accountId || lastServer !== server))
    send(lastServer, lastAccount, []);
  lastAccount = accountId;
  lastServer = server;
  if (!accountId || !server) return;
  const { spaces, snapshotReady, referenceOnly } = useSpacesStore.getState();
  // Only a live list changes what is mounted: a stand-in list kept from before (offline) doesn't.
  if (!snapshotReady || referenceOnly || !listIsAccounts(spaces, accountId)) return;
  send(
    server,
    accountId,
    spaces.map((space) => ({ id: space.id, name: space.name })),
  );
}

/**
 * Keeps native's mounted Space drives in step with the signed-in account and its Spaces: on start,
 * sign-in, joining, leaving and renaming a Space, and an empty list on sign-out. Started once per
 * window; it lasts as long as the window, outside any component, so a sign-out that unmounts the
 * shell still reaches native.
 */
export function startDriveSpacesSync() {
  if (started || !hasTauriInternals()) return;
  started = true;
  useUserStore.subscribe(sync);
  useSpacesStore.subscribe(sync);
  useServerChoice.subscribe(sync);
  sync();
}
