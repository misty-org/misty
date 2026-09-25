import { NotesConnectorRegistry } from "./NotesConnectorRegistry";
import { createMistyNativeNotesConnector } from "./mistyNativeNotes";
export { NotesConnectorRegistry, adjacentIntegrations } from "./NotesConnectorRegistry";

export function createDefaultNotesRegistry(
  accountId = "",
  spaceId = "",
  spaceName = "",
): NotesConnectorRegistry {
  return new NotesConnectorRegistry([
    createMistyNativeNotesConnector(accountId, spaceId, spaceName),
  ]);
}
