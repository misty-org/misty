import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { DesktopSettingsRow, DesktopSettingsSection as Section } from "@/features/settings";
import type { AgentProfile } from "@/shared/schemas";
import {
  Button,
  FieldError,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/shared/ui";
import { mistyEngine, useEnginesList, type EngineInfo } from "../engines/enginesApi";
import { AgentAvatar } from "../personal/AgentAvatar";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { saveAgent } from "../virtual/HireAgent";
import { useAgentsHub } from "./agentsHubStore";
import {
  AgentFolderChoice,
  giveNewAgentFolder,
  type NewAgentFolder,
} from "../shared-folders/AgentFolderChoice";

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
 * A new agent: the engine it runs on and its name, which is the engine's until the person gives
 * another. An engine that isn't installed can't be picked; its CLI is installed from the CLIs page.
 */
function NewAgent({ onMade }: { onMade(agent: AgentProfile): void }) {
  const engines = useEngines();
  const [engine, setEngine] = useState("");
  const [name, setName] = useState("");
  const [folder, setFolder] = useState<NewAgentFolder>("new");
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
        name: name.trim() || picked.name,
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
      await giveNewAgentFolder(agent, folder);
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
          <Button onClick={() => useAgentsHub.getState().setPage("clis")}>Install a CLI</Button>
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
          placeholder={picked?.name ?? "Name"}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
          }}
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow label="Folder" density="compact">
        <AgentFolderChoice value={folder} onChange={setFolder} disabled={busy} />
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
 * The Agents window's first page: the person's agents, each a click from a new chat, and making
 * another. The agent picked here is the one New starts a chat with from then on.
 */
export function HubAgentsPage({ onChat }: { onChat(agent: AgentProfile): void }) {
  const agents = usePersonalAgentsStore((state) => state.agents);
  const loading = usePersonalAgentsStore((state) => state.loading);
  // Misty's own runtime stays in the code, never offered as an agent to pick.
  const listed = agents.filter((agent) => agent.enabled && !agent.system_managed);
  const engines = useEngines();
  const engineName = (id?: string) => engines?.find((item) => item.id === id)?.name ?? "";
  const chat = (agent: AgentProfile) => {
    usePersonalAgentsStore.getState().select("", agent.id);
    onChat(agent);
  };
  return (
    <div className="grid gap-8">
      <div data-tour="agents-list">
        <Section title="Your agents">
          {loading && !listed.length ? (
            <AgentRowsSkeleton />
          ) : (
            listed.map((agent) => (
              <DesktopSettingsRow
                key={agent.id}
                label={agent.name}
                description={engineName(agent.engine)}
                leading={<AgentAvatar agent={agent} />}
                density="compact"
              >
                <Button onClick={() => chat(agent)}>New chat</Button>
              </DesktopSettingsRow>
            ))
          )}
        </Section>
      </div>
      <div data-tour="agents-new">
        <NewAgent onMade={chat} />
      </div>
    </div>
  );
}
