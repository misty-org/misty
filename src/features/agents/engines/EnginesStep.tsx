import { useState } from "react";
import { ENGINE_IDS, type EngineId } from "@/features/engine-config/channels";
import { DisclosureButton, ListCard } from "@misty/ui";
import { EngineSetupRow, type EngineSetupState } from "./EngineSetupRow";

const FEATURED_ENGINES: readonly EngineId[] = ["claude", "codex", "agy"];
const otherEngines = (first: readonly EngineId[]) =>
  ENGINE_IDS.filter((engine) => !first.includes(engine));

export function EnginesStep({
  onState,
  first = FEATURED_ENGINES,
  chosen,
  onChoose,
  unfit,
}: {
  onState(engine: EngineId, state: EngineSetupState): void;
  first?: readonly EngineId[];
  chosen?: EngineId;
  onChoose?(engine: EngineId): void;
  unfit?(engine: EngineId): boolean;
}) {
  const [more, setMore] = useState(false);
  const row = (engine: EngineId) => (
    <EngineSetupRow
      key={engine}
      engine={engine}
      onState={onState}
      chosen={chosen === engine}
      onChoose={onChoose}
      unfit={unfit?.(engine)}
    />
  );
  const role = onChoose ? "radiogroup" : undefined;
  const rest = otherEngines(first);
  return (
    <div className="grid gap-3">
      <ListCard aria-label="Engines" role={role}>
        {first.map(row)}
      </ListCard>
      {rest.length > 0 ? (
        <DisclosureButton open={more} onClick={() => setMore((open) => !open)}>
          {more ? "Fewer engines" : "More engines"}
        </DisclosureButton>
      ) : null}
      {more && rest.length > 0 ? (
        <ListCard aria-label="More engines" role={role}>
          {rest.map(row)}
        </ListCard>
      ) : null}
    </div>
  );
}
