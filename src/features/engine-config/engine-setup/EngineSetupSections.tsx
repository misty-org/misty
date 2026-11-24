// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): CliConfigBody.tsx.
// See NOTICE.

import type { EngineId } from "../channels/engines";
import { EngineProgramSection } from "./EngineProgramSection";

export function EngineSetupSections({ engine }: { engine: EngineId }) {
  return <EngineProgramSection key={engine} engine={engine} />;
}
