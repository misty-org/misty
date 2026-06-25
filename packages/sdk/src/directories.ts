import {
  mistyDirectoryContracts,
  mistyDirectoryMutationContracts,
  type MistyDirectoryListing,
  type MistyOpenedEntry,
} from "@misty/contracts";
import type { MistyCall } from "./transport.js";
export interface MistyDirectorySDK {
  /** macOS: open this installation/account/Space's persistent Trash as an owned writable folder.
   * Existing transfer methods move entries into/out of it. Closing releases access, not its contents. */
  openTrash(): Promise<{ handle: string; name: "Trash"; writable: true }>;
  /** macOS: list this installation/account/Space's saved folder references without opening them. */
  listSavedDirectories(): Promise<readonly {bookmarkId:string;name:string;writable:boolean}[]>;

  /** macOS: retain a private native bookmark scoped to this installed App/account/Space. */
  rememberDirectory(directory: string, options?: {write?: boolean}): Promise<{bookmarkId:string;name:string;writable:boolean}>;
  /** macOS: restore the original folder into a fresh grant after permission approval. */
  reopenDirectory(bookmarkId: string, options?: {write?: boolean}): Promise<{handle:string;name:string;writable:boolean}>;
  /** Remove the saved reference. Independently open live handles are not released. */
  forgetDirectory(bookmarkId: string): Promise<void>;

  /** A single-use handoff to another live view of this installed App/account/Space.
   * Valid for 60 seconds while the source view, grant and permission remain live. */
  shareDirectory(directory: string, options?: { write?: boolean }): Promise<{ ticket: string; expiresInMs: 60000 }>;
  /** Adopt a handoff as an independently owned handle; never elevates its access. */
  adoptDirectory(ticket: string, options?: { write?: boolean }): Promise<{ handle: string; name: string; writable: boolean }>;
  cancelDirectoryShare(ticket: string): Promise<void>;

  createEntry(
    directory: string,
    name: string,
    kind: "file" | "directory",
  ): Promise<{ entry: string; name: string; kind: "file" | "directory" }>;
  renameEntry(
    directory: string,
    entry: string,
    name: string,
  ): Promise<{ entry: string; name: string }>;
  /** Permanently remove an entry. Recursive directory removal must be explicitly requested. */
  removeEntry(
    directory: string,
    entry: string,
    options?: { recursive?: boolean },
  ): Promise<void>;

  listDirectory(
    directory: string,
    options?: { offset?: number; limit?: number },
  ): Promise<MistyDirectoryListing>;
  openEntry(
    directory: string,
    entry: string,
    options?: { write?: boolean },
  ): Promise<MistyOpenedEntry>;
}
export function createDirectorySDK(call: MistyCall): MistyDirectorySDK {
  return Object.freeze({
    async openTrash() {
      const c = mistyDirectoryContracts["files.openTrash"];
      return c.result.parse(await call("files.openTrash", c.params.parse({})));
    },
    async listSavedDirectories() {
      const c=mistyDirectoryContracts["files.listSavedDirectories"];
      return c.result.parse(await call("files.listSavedDirectories", c.params.parse({})));
    },
    async rememberDirectory(directory: string, options: {write?: boolean} = {}) {
      const c = mistyDirectoryContracts["files.rememberDirectory"];
      return c.result.parse(await call("files.rememberDirectory", c.params.parse({directory,...options})));
    },
    async reopenDirectory(bookmarkId: string, options: {write?: boolean} = {}) {
      const c = mistyDirectoryContracts["files.reopenDirectory"];
      return c.result.parse(await call("files.reopenDirectory", c.params.parse({bookmarkId,...options})));
    },
    async forgetDirectory(bookmarkId: string) {
      const c = mistyDirectoryContracts["files.forgetDirectory"];
      c.result.parse(await call("files.forgetDirectory", c.params.parse({bookmarkId})));
    },
    async shareDirectory(directory: string, options: { write?: boolean } = {}) {
      const c = mistyDirectoryContracts["files.shareDirectory"];
      return c.result.parse(await call("files.shareDirectory", c.params.parse({ directory, ...options })));
    },
    async adoptDirectory(ticket: string, options: { write?: boolean } = {}) {
      const c = mistyDirectoryContracts["files.adoptDirectory"];
      return c.result.parse(await call("files.adoptDirectory", c.params.parse({ ticket, ...options })));
    },
    async cancelDirectoryShare(ticket: string) {
      const c = mistyDirectoryContracts["files.cancelDirectoryShare"];
      c.result.parse(await call("files.cancelDirectoryShare", c.params.parse({ ticket })));
    },
    async createEntry(
      directory: string,
      name: string,
      kind: "file" | "directory",
    ) {
      const contract = mistyDirectoryMutationContracts["files.createEntry"];
      return contract.result.parse(
        await call(
          "files.createEntry",
          contract.params.parse({ directory, name, kind }),
        ),
      );
    },
    async renameEntry(directory: string, entry: string, name: string) {
      const contract = mistyDirectoryMutationContracts["files.renameEntry"];
      return contract.result.parse(
        await call(
          "files.renameEntry",
          contract.params.parse({ directory, entry, name }),
        ),
      );
    },
    async removeEntry(
      directory: string,
      entry: string,
      options: { recursive?: boolean } = {},
    ) {
      const contract = mistyDirectoryMutationContracts["files.removeEntry"];
      contract.result.parse(
        await call(
          "files.removeEntry",
          contract.params.parse({ directory, entry, ...options }),
        ),
      );
    },

    async listDirectory(
      directory: string,
      options: { offset?: number; limit?: number } = {},
    ) {
      const contract = mistyDirectoryContracts["files.listDirectory"];
      return contract.result.parse(
        await call(
          "files.listDirectory",
          contract.params.parse({ directory, ...options }),
        ),
      );
    },
    async openEntry(
      directory: string,
      entry: string,
      options: { write?: boolean } = {},
    ) {
      const contract = mistyDirectoryContracts["files.openEntry"];
      return contract.result.parse(
        await call(
          "files.openEntry",
          contract.params.parse({ directory, entry, ...options }),
        ),
      );
    },
  });
}
