import { useDocVersion } from "../grid/sheetView";
import { useWorkbookRoom } from "../useWorkbookRoom";

/**
 * A workbook opened read-only for an embed: the shared room this window already has open (or a
 * new one), joined without presence, so nobody sees an embed as a person in the workbook.
 */
export function useEmbeddedWorkbook(spaceId: string, workbookId: string) {
  const room = useWorkbookRoom(spaceId, workbookId, null);
  const session = room.session && room.synced ? room.session : null;
  const version = useDocVersion(session?.doc ?? null);
  return {
    session,
    engine: session ? session.engine() : null,
    version,
    lost: room.lost,
    error:
      room.error ??
      (room.connection === "error" && !session ? "The workbook couldn't be reached." : null),
    retry: room.retry,
  };
}
