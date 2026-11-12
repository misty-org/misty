import { useCallback, useId, useMemo, useState } from "react";
import { ENGINE_IDS, ENGINE_NAMES, type EngineId } from "@/features/engine-config/channels";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  useNotice,
  Field,
  Input,
  Label,
} from "@/shared/ui";
import type { AgentProfile } from "@/shared/schemas";
import { agentAccountId } from "../personal/agentAccount";
import { newAgentOn } from "../personal/personalAgentsApi";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { EnginesStep, FEATURED_ENGINES } from "./EnginesStep";
import type { EngineSetupState } from "./EngineSetupRow";

const isEngine = (id: string | undefined): id is EngineId =>
  Boolean(id) && (ENGINE_IDS as readonly string[]).includes(id!);

/**
 * A new agent: the engine it runs on, installed and signed in from here if it isn't yet, and a
 * name, which is the engine's until the person gives another. Its model and the rest are set in
 * the agent's settings.
 */
export function NewAgentDialog({
  agents,
  onClose,
  onCreated,
}: {
  /** The person's agents now: the engines they already use lead the list. */
  agents: AgentProfile[];
  onClose(): void;
  onCreated(agentId: string): void;
}) {
  // The engines the person already has agents on lead, then the ones most people use.
  const first = useMemo(() => {
    const own = agents.map((agent) => agent.engine).filter(isEngine);
    return [...new Set([...own, ...FEATURED_ENGINES])];
  }, [agents]);
  const [ready, setReady] = useState<EngineId[]>([]);
  const [chosen, setChosen] = useState<EngineId>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const engineLabel = useId();
  const [error, setError] = useState("");
  const onState = useCallback((engine: EngineId, state: EngineSetupState) => {
    setReady((current) => {
      const has = current.includes(engine);
      if (state === "ready" && !has) return [...current, engine];
      if (state !== "ready" && has) return current.filter((id) => id !== engine);
      return current;
    });
  }, []);
  // The first engine to be ready is picked until the person picks one.
  const engine = chosen && ready.includes(chosen) ? chosen : ready.find((id) => first.includes(id));

  const create = async () => {
    if (!engine || busy) return;
    setBusy(true);
    setError("");
    try {
      const account = agentAccountId();
      const agent = await newAgentOn(
        account,
        { id: engine, name: ENGINE_NAMES[engine], installed: true, version: null },
        name,
      );
      await usePersonalAgentsStore.getState().load(account);
      onCreated(agent.id);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The agent couldn't be made.");
      setBusy(false);
    }
  };

  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[86vh] w-[560px] max-w-[94vw] flex-col gap-4 overflow-y-auto p-5"
      >
        <DialogTitle className="pr-10 text-base">New agent</DialogTitle>
        <Field label="Name">
          <Input
            maxLength={80}
            value={name}
            placeholder={engine ? ENGINE_NAMES[engine] : "Name"}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="grid gap-1.5">
          <Label id={engineLabel} className="text-cream">
            Engine
          </Label>
          <div role="group" aria-labelledby={engineLabel}>
            <EnginesStep onState={onState} first={first} chosen={engine} onChoose={setChosen} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!engine || busy} onClick={() => void create()}>
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
