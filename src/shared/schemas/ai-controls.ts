import { z } from "zod";

export const MistyAiControlsSnapshotSchema = z.strictObject({
  available: z.boolean(),
  following: z.boolean(),
  proposal: z
    .strictObject({
      id: z.string().min(1).max(256),
      kind: z.string().min(1).max(80),
      state: z.enum(["proposed", "applying", "applied", "rejected", "stale", "failed"]),
      stale: z.boolean(),
      replacement: z.string().max(65536).optional(),
    })
    .optional(),
});

export type MistyAiControlsSnapshot = z.output<typeof MistyAiControlsSnapshotSchema>;
