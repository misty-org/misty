import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { DesktopSettingsRow, DesktopSettingsSection as Section } from "@/features/settings";
import type { AgentProfile } from "@/shared/schemas";
import {
  Button,
  ConfirmDeleteDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  FieldError,
  Input,
  MenuItem,
  MenuTrigger,
  RenameItemDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/shared/ui";
import type { EngineId } from "@/features/engine-config/channels";
import { blocksAgent, useEngineReadiness } from "../engines/engineReadiness";
import { EngineNextStep } from "../engines/EngineNextStep";
import { mistyEngine, useEnginesList, type EngineInfo } from "../engines/enginesApi";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { personalAgentsApi } from "../personal/personalAgentsApi";
import { AgentAvatar } from "../personal/AgentAvatar";
import { freshAgentName } from "../personal/agentNames";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { saveAgent, updateAgent } from "../personal/saveAgent";
import { openAgentsHub } from "./agentsHubStore";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The engines Misty can start, the ones installed here first: the last list paints at once and a
 * fresh one follows. Null only on the very first load, with nothing saved.
 */
function useEngines() {
  const { data, loading } = useEnginesList();
  return useMemo(
    () =>
      data
        ? data
            .filter((item) => item.id !== mistyEngine)
            .sort((a, b) => Number(b.installed) - Number(a.installed))
        : loading
          ? null
          : [],
    [data, loading],
  );
}

const agentNameWidths = ["w-32", "w-40", "w-28"];

/**
 * Agent rows on their first load, in DesktopSettingsRow's compact shape: the 40px avatar, the name
 * and engine lines, and the New chat button.
 */
function AgentRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          // An empty label keeps the panel's padding and hairlines without naming a setting.
          data-setting-label=""
          role={index === 0 ? "status" : undefined}
          aria-label={index === 0 ? "Your agents" : undefined}
          aria-busy={index === 0 || undefined}
          className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 py-3"
        >
          <div className="flex min-w-0 items-center gap-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="flex h-6 items-center">
                <Skeleton className={`h-4 ${agentNameWidths[index % agentNameWidths.length]}`} />
              </div>
              <div className="flex h-6 items-center">
                <Skeleton className="h-3.5 w-20" />
              </div>
            </div>
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      ))}
    </>
  );
}

function engineIcon(engine: EngineInfo) {
  return hasEngineMark(engine.id) ? (
    <EngineMark engine={engine.id} name={engine.name} size={14} />
  ) : undefined;
}

/**
 * A new agent: the engine it runs on and its name, one of its own (`freshAgentName`) until the
 * person gives another, never the engine's. An engine that isn't installed can't be picked; its
 * CLI is installed from the CLIs page.
 */
function NewAgent({ onMade }: { onMade(agent: AgentProfile): void }) {
  const engines = useEngines();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const suggested = useMemo(() => freshAgentName(agents.map((agent) => agent.name)), [agents]);
  const [engine, setEngine] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!engine && engines) setEngine(engines.find((item) => item.installed)?.id ?? "");
  }, [engine, engines]);
  const picked = engines?.find((item) => item.id === engine);
  const create = async () => {
    if (busy || !picked) return;
    setBusy(true);
    setError("");
    try {
      const agent = await saveAgent({
        name: name.trim() || suggested,
        role: "",
        description: "",
        instructions: "",
        icon: "",
        avatar: {},
        model_mode: "automatic",
        model_id: "",
        reasoning_effort: "",
        enabled: true,
        default_run_mode: "ask",
        engine: picked.id,
      });
      setName("");
      onMade(agent);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  const noneInstalled = engines !== null && !engines.some((item) => item.installed);
  return (
    <Section title="New agent">
      <DesktopSettingsRow label="Engine" density="compact">
        {engines === null ? (
          <Skeleton className="h-8 w-56 rounded-md" />
        ) : noneInstalled ? (
          <Button onClick={() => openAgentsHub("clis")}>Install a CLI</Button>
        ) : (
          <Select value={engine} onValueChange={setEngine}>
            <SelectTrigger className="w-56" aria-label="Engine">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {engines.map((item) => (
                <SelectItem
                  key={item.id}
                  value={item.id}
                  icon={engineIcon(item)}
                  label={item.name}
                  disabled={!item.installed}
                  reason={item.installed ? undefined : "Install it on the CLIs page"}
                />
              ))}
            </SelectContent>
          </Select>
        )}
      </DesktopSettingsRow>
      <DesktopSettingsRow label="Name" density="compact">
        <Input
          aria-label="Name"
          className="w-56"
          placeholder={suggested}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
          }}
        />
      </DesktopSettingsRow>
      <div className="flex items-center justify-between gap-3">
        <FieldError message={error} />
        <Button
          variant="primary"
          className="ml-auto"
          disabled={!picked?.installed || busy}
          onClick={() => void create()}
        >
          <Plus />
          Create agent
        </Button>
      </div>
    </Section>
  );
}

/**
 * Deletes an agent and its chats: a chat can't be opened without its agent, so none is left
 * behind. The chats go first, so a failure part way leaves the agent to try again with.
 */
async function deleteAgent(agent: AgentProfile) {
  const store = useMistyStore.getState();
  for (const chat of store.conversations.filter((chat) => chat.agentId === agent.id))
    await store.deleteConversation(chat.id);
  await personalAgentsApi.remove(agent.id);
  usePersonalAgentsStore.setState((state) => ({
    agents: state.agents.filter((known) => known.id !== agent.id),
    selected: state.selected.global === agent.id ? {} : state.selected,
  }));
}

/**
 * One of the person's agents. Until its engine is installed and signed in it stays disabled:
 * New chat gives way to the engine's next step (Install, Get it or Sign in), so a chat never
 * starts on an engine that can't answer.
 */
function AgentRow({ agent, engineName }: { agent: AgentProfile; engineName: string }) {
  const engine = agent.engine && agent.engine !== mistyEngine ? agent.engine : "";
  const { view, state } = useEngineReadiness(engine);
  const held = blocksAgent(state);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const chatCount = useMistyStore(
    (state) => state.conversations.filter((chat) => chat.agentId === agent.id).length,
  );
  return (
    <DesktopSettingsRow
      label={agent.name}
      // The engine under the agent, by name (its mark is already the agent's picture), and what
      // keeps an agent that isn't ready from working.
      description={
        held
          ? `${engineName} · ${state === "sign-in" ? "Not signed in" : "Not installed"}`
          : engineName
      }
      // Not ready yet (its engine isn't installed or signed in): shown dimmed beside its next step.
      muted={held}
      leading={<AgentAvatar agent={agent} />}
      density="compact"
    >
      {engine ? (
        <EngineNextStep engine={engine as EngineId} view={view} state={held ? state : "ready"} />
      ) : null}
      <DropdownMenu>
        <MenuTrigger label={`${agent.name} actions`} iconOnly icon={MoreHorizontal} />
        <DropdownMenuContent align="end">
          <MenuItem icon={Pencil} label="Rename" onSelect={() => setRenaming(true)} />
          <DropdownMenuSeparator />
          <MenuItem icon={Trash2} label="Delete" danger onSelect={() => setDeleting(true)} />
        </DropdownMenuContent>
      </DropdownMenu>
      {renaming ? (
        <RenameItemDialog
          key={agent.id}
          title="Rename agent"
          initialName={agent.name}
          onConfirm={(name) => updateAgent(agent, { name })}
          onClose={() => setRenaming(false)}
        />
      ) : null}
      <ConfirmDeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${agent.name}”?`}
        what={
          chatCount
            ? `${agent.name} and its ${chatCount === 1 ? "chat" : `${chatCount} chats`} will be deleted from this computer. This can't be undone.`
            : `${agent.name} will be deleted from this computer. This can't be undone.`
        }
        onConfirm={() => deleteAgent(agent)}
      />
    </DesktopSettingsRow>
  );
}

/**
 * Settings › Agents › Team: the person's agents, each with its engine and what it still needs,
 * and making another. A new agent becomes the one New starts a chat with; any agent is picked for
 * a chat in the composer.
 */
export function HubAgentsPage() {
  const agents = usePersonalAgentsStore((state) => state.agents);
  const loading = usePersonalAgentsStore((state) => state.loading);
  // Misty's own runtime stays in the code, never offered as an agent to pick.
  const listed = agents.filter((agent) => agent.enabled && !agent.system_managed);
  const engines = useEngines();
  const engineName = (id?: string) => engines?.find((item) => item.id === id)?.name ?? "";
  return (
    <div className="grid gap-8">
      <div data-tour="agents-list">
        <Section title="Your agents">
          {loading && !listed.length ? (
            <AgentRowsSkeleton />
          ) : (
            listed.map((agent) => (
              <AgentRow key={agent.id} agent={agent} engineName={engineName(agent.engine)} />
            ))
          )}
        </Section>
      </div>
      <div data-tour="agents-new">
        <NewAgent onMade={(agent) => usePersonalAgentsStore.getState().select("", agent.id)} />
      </div>
    </div>
  );
}
