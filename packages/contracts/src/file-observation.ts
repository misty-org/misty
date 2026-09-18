import { z } from "zod";

const handle = z.string().min(1).max(256);
const timestamp = z.number().int().safe().nullable();
export const MistyFileMetadataSchema = z.strictObject({
  kind: z.enum(["file", "directory"]),
  bytes: z.number().int().nonnegative().safe(),
  modifiedMs: timestamp,
  createdMs: timestamp,
  /** Filesystem permission flag; does not grant permission to write. */
  readOnly: z.boolean(),
  writeGranted: z.boolean(),
});
const read = <P extends z.ZodType, R extends z.ZodType>(params: P, result: R) => ({
  capability: "files.read" as const,
  platforms: ["macos"] as const,
  params, result,
});
export const mistyFileObservationContracts = {
  "files.stat": read(z.strictObject({ handle }), MistyFileMetadataSchema),
  "files.watchDirectory": read(z.strictObject({ directory: handle }), z.strictObject({ watcher: handle })),
  "files.watchStatus": read(z.strictObject({ watcher: handle }), z.strictObject({
    revision: z.number().int().nonnegative().safe(),
    active: z.boolean(),
    reason: z.enum(["root_changed", "watch_failed"]).nullable(),
  })),
  "files.watchClose": read(z.strictObject({ watcher: handle }), z.union([z.null(), z.undefined()]).transform(() => undefined)),
} as const;
export type MistyFileMetadata = z.output<typeof MistyFileMetadataSchema>;
export type MistyDirectoryWatchStatus = z.output<typeof mistyFileObservationContracts["files.watchStatus"]["result"]>;
