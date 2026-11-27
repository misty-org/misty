import * as z from "zod/mini";

export const MistyAiControlsSnapshotSchema = z.strictObject({
  available: z.boolean(),
  proposal: z.optional(
    z.strictObject({
      id: z.string().check(z.minLength(1), z.maxLength(256)),
      kind: z.string().check(z.minLength(1), z.maxLength(80)),
      state: z.enum(["proposed", "applying", "applied", "rejected", "stale", "failed"]),
      stale: z.boolean(),
      replacement: z.optional(z.string().check(z.maxLength(65536))),
    }),
  ),
});
