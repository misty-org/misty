import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { ENGINE_IDS, type EngineId } from "@/features/engine-config/channels";
import { Button, cn } from "@/shared/ui";
import { EngineSetupRow, type EngineSetupState } from "./EngineSetupRow";

/** The engines most people already pay for, shown first; the rest wait behind More. */
export const FEATURED_ENGINES: readonly EngineId[] = ["claude", "codex", "gemini", "opencode"];
// Read when shown: the engine list belongs to a feature that imports this one.
const otherEngines = (first: readonly EngineId[]) =>
  ENGINE_IDS.filter((engine) => !first.includes(engine));

const listClass =
  "divide-y divide-charcoal-border overflow-hidden rounded-[12px] border border-charcoal-border bg-charcoal-card";

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
      <ul aria-label="Engines" role={role} className={listClass}>
        {first.map(row)}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="justify-self-start text-cream-muted"
        aria-expanded={more}
        onClick={() => setMore((open) => !open)}
      >
        <ChevronDown className={cn("transition-transform", more && "rotate-180")} />
        {more ? "Fewer engines" : "More engines"}
      </Button>
      {/* Mounted only when opened, so first run doesn't probe fifteen CLIs at once. */}
      {more ? (
        <ul aria-label="More engines" role={role} className={listClass}>
          {otherEngines(first).map(row)}
        </ul>
      ) : null}
    </div>
  );
}
