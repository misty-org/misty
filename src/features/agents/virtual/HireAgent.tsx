import { Check, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { Button, ChoiceTile, Field, Input, Skeleton, Text, Tooltip, useNotice } from "@/shared/ui";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { mistyEngine, useEnginesList } from "../engines/enginesApi";
import { personalAgentsApi } from "../personal/personalAgentsApi";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import {
  AgentFolderChoice,
  giveNewAgentFolder,
  type NewAgentFolder,
} from "../shared-folders/AgentFolderChoice";
import { StudioSide, StudioSideHead } from "./StudioHud";

/** Saves an agent and puts it straight into the list everything reads, without a reload. */
export async function saveAgent(
  input: AgentProfileInput & { version?: number },
  id?: string,
): Promise<AgentProfile> {
  const saved = await personalAgentsApi.save(input, id);
  usePersonalAgentsStore.setState((state) => ({
    agents: state.agents.some((agent) => agent.id === saved.id)
      ? state.agents.map((agent) => (agent.id === saved.id ? saved : agent))
      : [...state.agents, saved],
  }));
  return saved;
}

/** Changes one of the person's agents' name or role, keeping everything else about it. */
export function updateAgent(
  agent: AgentProfile,
  change: { name?: string; role?: string },
): Promise<AgentProfile> {
  const {
    name,
    role,
    description,
    instructions,
    icon,
    avatar,
    model_mode,
    model_id,
    reasoning_effort,
    enabled,
    default_run_mode,
    engine,
    engine_model,
    version,
  } = agent;
  return saveAgent(
    {
      name: (change.name ?? name).trim(),
      role: (change.role ?? role).trim(),
      description,
      instructions,
      icon,
      avatar,
      model_mode,
      model_id,
      reasoning_effort,
      enabled,
      default_run_mode,
      engine,
      engine_model,
      version,
    },
    agent.id,
  );
}

/**
 * Hiring, the studio's shop: a card for each engine installed on this computer and for Misty's
 * own, then a name and what the agent is for. Several agents can run on one engine, each with its
 * own name, role, memory and chats, so there can be a team of Claude Codes. Hired from a free
 * desk, the new agent takes that desk. Everything else is set later in the agent's settings.
 */
export function HirePanel(props: {
  /** The free desk it was opened from, which the new agent gets. */
  deskId?: string;
  onHired(agent: AgentProfile, deskId?: string): void;
}) {
  // The last engine list paints at once and a fresh one follows; null only on the first load.
  const list = useEnginesList();
  const engines = useMemo(
    () =>
      list.data
        ? // Every engine Misty has an adapter for, the ones installed here first.
          list.data
            .filter((item) => item.id !== mistyEngine)
            .sort((a, b) => Number(b.installed) - Number(a.installed))
        : list.loading
          ? null
          : [],
    [list.data, list.loading],
  );
  const [picked, setEngine] = useState("");
  const engine = picked || engines?.find((item) => item.installed)?.id || "";
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [folder, setFolder] = useState<NewAgentFolder>("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  const hire = async () => {
    if (busy || !name.trim() || !engine) return;
    setBusy(true);
    setError("");
    try {
      const agent = await saveAgent({
        name: name.trim(),
        role: role.trim(),
        description: "",
        instructions: "",
        icon: "",
        avatar: {},
        model_mode: "automatic",
        model_id: "",
        reasoning_effort: "",
        enabled: true,
        default_run_mode: "ask",
        engine,
      });
      await giveNewAgentFolder(agent, folder);
      setName("");
      setRole("");
      props.onHired(agent, props.deskId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const cards = engines ?? [];
  return (
    <StudioSide className="w-75 overflow-y-auto" aria-label="Hire an agent">
      <StudioSideHead title={props.deskId ? "Hire for this desk" : "Hire an agent"} />
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void hire();
        }}
      >
        {/* Hiring: a card for each engine. */}
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Engine">
          {engines === null
            ? Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-18 rounded-xl" />
              ))
            : cards.map((card) => (
                <Tooltip
                  key={card.id}
                  content={
                    card.installed ? card.name : `${card.name} isn't installed on this computer`
                  }
                >
                  {/* An engine that isn't installed shows, as a locked item does in a shop, but
                      can't be picked. */}
                  <ChoiceTile
                    radio
                    look="outline"
                    selected={engine === card.id}
                    aria-disabled={!card.installed || undefined}
                    label={card.installed ? card.name : `${card.name}, not installed`}
                    caption={card.name}
                    className="relative gap-1.5 px-1.5 pt-2.5 pb-2"
                    data-locked={!card.installed || undefined}
                    onSelect={() => card.installed && setEngine(card.id)}
                  >
                    <span className="grid size-8 place-items-center" aria-hidden="true">
                      {hasEngineMark(card.id) ? (
                        <EngineMark engine={card.id} size={20} />
                      ) : (
                        <Text bare size="body" weight="semibold">
                          {card.name[0]}
                        </Text>
                      )}
                    </span>
                    {engine === card.id ? (
                      <Text bare tone="bright" className="absolute top-1.5 right-1.5 flex">
                        <Check aria-hidden="true" />
                      </Text>
                    ) : !card.installed ? (
                      <Text bare tone="muted" className="absolute top-1.5 right-1.5 flex">
                        <Lock aria-hidden="true" />
                      </Text>
                    ) : null}
                  </ChoiceTile>
                </Tooltip>
              ))}
        </div>
        <div className="grid gap-3">
          <Field label="Name">
            <Input
              required
              autoFocus
              maxLength={80}
              placeholder="Ada"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Role">
            <Input
              maxLength={160}
              placeholder="Reviews pull requests"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </Field>
          <Field label="Folder">
            <AgentFolderChoice value={folder} onChange={setFolder} disabled={busy} />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={busy || !name.trim() || !engine}>
          Hire
        </Button>
      </form>
    </StudioSide>
  );
}
