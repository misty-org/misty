import type * as z from "zod/mini";
import type { MistyAiControlsSnapshotSchema } from "./ai_controls_schema";

export type MistyAiControlsSnapshot = z.output<typeof MistyAiControlsSnapshotSchema>;
