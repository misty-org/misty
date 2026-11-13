import { useState } from "react";
import { ENGINE_IDS, type EngineId } from "@/features/engine-config/channels";
import { DisclosureButton, ListCard } from "@/shared/ui";
import { EngineSetupRow, type EngineSetupState } from "./EngineSetupRow";

/**
 * Shown first, the rest wait behind More: the two that cost nothing (Antigravity on any Google
 * account, OpenCode's free models with no account), then the two most people already pay for.
 * Gemini CLI stopped taking personal Google accounts in June 2026, so it waits under More.
 */
const FEATURED_ENGINES: readonly EngineId[] = ["agy", "opencode", "codex", "claude"];
// Read when shown: the engine list belongs to a feature that imports this one.
const otherEngines = (first: readonly EngineId[]) =>
  ENGINE_IDS.filter((engine) => !first.includes(engine));

/** The first step: the AI the person already uses, installed and signed in from here. */
export function EnginesStep({
  onState,
  first = FEATURED_ENGINES,
  chosen,
  onChoose,
}: {
  onState(engine: EngineId, state: EngineSetupState): void;
  /** The engines listed before More; the featured ones unless the caller knows better. */
  first?: readonly EngineId[];
  /** With `onChoose`, one ready engine can be picked. */
  chosen?: EngineId;
  onChoose?(engine: EngineId): void;
}) {
  const [more, setMore] = useState(false);
  const row = (engine: EngineId) => (
    <EngineSetupRow
      key={engine}
      engine={engine}
      onState={onState}
      chosen={chosen === engine}
      onChoose={onChoose}
    />
  );
  const role = onChoose ? "radiogroup" : undefined;
  return (
    <div className="grid gap-3">
      <ListCard aria-label="Engines" role={role}>
        {first.map(row)}
      </ListCard>
      <DisclosureButton open={more} onClick={() => setMore((open) => !open)}>
        {more ? "Fewer engines" : "More engines"}
      </DisclosureButton>
      {/* Mounted only when opened, so first run doesn't probe fifteen CLIs at once. */}
      {more ? (
        <ListCard aria-label="More engines" role={role}>
          {otherEngines(first).map(row)}
        </ListCard>
      ) : null}
    </div>
  );
}
