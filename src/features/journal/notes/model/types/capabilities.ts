/**
 * What a note source can actually do. The UI reads these instead of probing for
 * optional methods, so a connector that gains write support announces it in one
 * place rather than changing how every component feature-detects.
 */
export interface NoteConnectorCapabilities {
  /** Can list and read notes. Every connector has this. */
  read: boolean;
  /** Can create a new note/page in the source. */
  create: boolean;
  /** Can append content to the end of an existing note. */
  append: boolean;
  /** Can replace a note's title/body in place. */
  update: boolean;
  /** Can permanently delete a note in the source. */
  delete: boolean;
  /** Can update known, simple structured properties. */
  updateProperties: boolean;
  /** Can open the note in its native app. */
  openInSource: boolean;
  /** Can be refreshed on demand. */
  sync: boolean;
  /** Exposes selectable sources (Notion pages/databases) to subscribe to. */
  selectSources: boolean;
}

/** A Notion page or database a Space can subscribe to as a note source. */
export type NoteSourceKind = "page" | "database";
