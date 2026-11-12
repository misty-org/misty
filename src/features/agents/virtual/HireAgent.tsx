import { Check, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { Button, ErrorNotification, Field, Input, Pressable, Skeleton } from "@/shared/ui";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { listEngines, mistyEngine, type EngineInfo } from "../engines/enginesApi";
import { personalAgentsApi } from "../personal/personalAgentsApi";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";

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

/** Renames one of the person's agents. */
export const renameAgent = (agent: AgentProfile, name: string) => updateAgent(agent, { name });

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
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [engine, setEngine] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (engines) return;
    let live = true;
    void listEngines()
      .then((found) => {
        if (!live) return;
        // Every engine Misty has an adapter for, the ones installed here first.
        const listed = found
          .filter((item) => item.id !== mistyEngine)
          .sort((a, b) => Number(b.installed) - Number(a.installed));
        setEngines(listed);
        setEngine((known) => known || listed.find((item) => item.installed)?.id || "");
      })
      .catch(() => {
        if (!live) return;
        setEngines([]);
      });
    return () => {
      live = false;
    };
  }, [engines]);

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
        icon: "sparkles",
        avatar: {},
        model_mode: "automatic",
        model_id: "",
        reasoning_effort: "",
        enabled: true,
        default_run_mode: "ask",
        engine,
      });
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
    <aside className="virtual-studio-side virtual-studio-shop" aria-label="Hire an agent">
      <header className="virtual-studio-side-head">
        <h3>{props.deskId ? "Hire for this desk" : "Hire an agent"}</h3>
      </header>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void hire();
        }}
      >
        <div className="virtual-studio-shop-cards" role="radiogroup" aria-label="Engine">
          {engines === null
            ? Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-[74px] rounded-xl" />
              ))
            : cards.map((card) => (
                <Pressable
                  key={card.id}
                  type="button"
                  role="radio"
                  aria-checked={engine === card.id}
                  aria-disabled={!card.installed || undefined}
                  aria-label={card.installed ? card.name : `${card.name}, not installed`}
                  title={
                    card.installed ? card.name : `${card.name} isn't installed on this computer`
                  }
                  className="virtual-studio-shop-card"
                  data-locked={!card.installed || undefined}
                  onClick={() => card.installed && setEngine(card.id)}
                >
                  <span className="virtual-studio-shop-mark" aria-hidden="true">
                    {hasEngineMark(card.id) ? (
                      <EngineMark engine={card.id} size={20} />
                    ) : (
                      <span className="text-base font-semibold">{card.name[0]}</span>
                    )}
                  </span>
                  <span className="w-full truncate text-center text-xs font-medium">
                    {card.name}
                  </span>
                  {engine === card.id ? (
                    <Check className="virtual-studio-shop-badge" size={13} aria-hidden="true" />
                  ) : !card.installed ? (
                    <Lock className="virtual-studio-shop-badge" size={11} aria-hidden="true" />
                  ) : null}
                </Pressable>
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
        </div>
        <Button type="submit" variant="primary" disabled={busy || !name.trim() || !engine}>
          Hire
        </Button>
      </form>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </aside>
  );
}
