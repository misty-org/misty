import type {
  NotesConnector,
  NotesIntegrationCard,
  SyncResult,
} from "../model/interfaces/connectors";
import type { UnifiedNote } from "../model/types/types";

/**
 * Fan-out layer over the registered connectors. The UI asks the registry for
 * notes; it never learns which source answered. Adding a connector is a push
 * here, with no change to any component.
 */
export class NotesConnectorRegistry {
  private readonly connectors: NotesConnector[];

  constructor(connectors: NotesConnector[]) {
    this.connectors = connectors;
  }

  list(): NotesConnector[] {
    return [...this.connectors];
  }

  get(connectorId: string): NotesConnector | undefined {
    return this.connectors.find((connector) => connector.id === connectorId);
  }

  forSource(source: UnifiedNote["source"]): NotesConnector | undefined {
    return this.connectors.find((connector) => connector.source === source);
  }

  /**
   * A failing connector must not blank the list — it yields nothing and the
   * surviving sources still render, which is what keeps a sync error calm.
   */
  async listAllNotes(): Promise<{ notes: UnifiedNote[]; errors: Record<string, string> }> {
    const errors: Record<string, string> = {};
    const results = await Promise.all(
      this.connectors.map(async (connector) => {
        try {
          return await connector.listNotes();
        } catch (error) {
          errors[connector.id] = error instanceof Error ? error.message : String(error);
          return [] as UnifiedNote[];
        }
      }),
    );
    return { notes: results.flat(), errors };
  }

  async syncAll(): Promise<SyncResult[]> {
    const results = await Promise.all(
      this.connectors.map((connector) => connector.sync?.() ?? Promise.resolve(undefined)),
    );
    return results.filter((result): result is SyncResult => result !== undefined);
  }
}

/**
 * Integrations that exist in Misty but are not note sources yet. They stay
 * visible so the Notes area reads as one view onto the shared connector system
 * rather than a private integration list.
 */
export const adjacentIntegrations: NotesIntegrationCard[] = [];
